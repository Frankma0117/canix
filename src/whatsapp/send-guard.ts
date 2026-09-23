import { db } from '../db/pool.js';
import { env } from '../config/env.js';
import { nowLocal, todayLocal, addDays, parseWall } from '../util/datetime.js';

/**
 * A last line of defense against the two send patterns that most reliably get a WhatsApp number
 * flagged/restricted (see README "Cómo evitar que WhatsApp bloquee/restrinja el número"):
 *   - 'proactive': the bot pushing a message the person didn't just ask for RIGHT NOW (reminders,
 *     routines, the weekly report, interval alerts) - a runaway loop or a bug here is exactly the
 *     "one-way broadcast" pattern WhatsApp's spam detection watches for. Gated in task-scheduler.ts.
 *   - 'cold': send_message writing to someone who has never messaged this bot's number before -
 *     the single riskiest category (WhatsApp explicitly watches messages-to-strangers ratios and
 *     block/report rates from first contact). Gated in send-message.tool.ts.
 * Deliberately NOT applied to a normal reply to something the person just wrote (the safest,
 * clearly-solicited category, and the core product) - throttling that would break the bot for no
 * safety benefit.
 *
 * Two independent protections, both backed by a tiny persisted log (survives restarts - a crash-
 * loop can't be used to bypass the daily cap):
 *   1. A daily cap per category (env MAX_DAILY_PROACTIVE_MESSAGES / MAX_DAILY_COLD_MESSAGES).
 *   2. A warm-up ramp on top of that cap for a number still new to this bot (see WARMUP_STAGES) -
 *      turns the manual "caliente el número gradualmente" README advice into something enforced
 *      instead of relying on the admin remembering to hold back by hand.
 */

export type SendCategory = 'proactive' | 'cold';

/** Minimum gap enforced between two 'cold' sends specifically (on top of the daily cap) - stops a
 *  single AI turn from rapid-firing several first-contact messages back to back if asked to message
 *  a short list of numbers in one go (e.g. "escríbele esto a estos 3 números"). Not applied to
 *  'proactive' sends - those already have their own inter-send pacing in task-scheduler.ts. */
const COLD_MIN_INTERVAL_MS = 6_000;

/** Ramp applied to the configured daily cap based on how many days this session has been linked -
 *  a number that just got connected for the first time is the most closely watched by WhatsApp's
 *  automated review, so it starts far below the steady-state cap and eases up over two weeks. */
const WARMUP_STAGES: { maxDays: number; factor: number }[] = [
  { maxDays: 2, factor: 0.15 },
  { maxDays: 6, factor: 0.4 },
  { maxDays: 13, factor: 0.7 },
];
const WARMUP_DONE_DAYS = 14; // at/after this many days, the full configured cap applies

/**
 * Tables `wa_send_log` / `wa_session_meta` are created centrally in db/init.ts (same as every
 * other table in this project) - initSchema() always runs before anything else touches the DB
 * (see index.ts), so nothing here needs its own schema bootstrap.
 */

/**
 * Records when a session was first ever seen connected, so the warm-up ramp has a starting point -
 * called once from wa-manager.ts right as the socket reaches 'open' for the first time. No-op if
 * already recorded (idempotent, safe on every reconnect).
 *
 * `wasAlreadyLinked` (Baileys' own `creds.registered` at buildSocket() time) distinguishes a brand
 * new QR pairing from an existing session that's simply upgrading to this feature - without this,
 * every deploy of this code onto an already-established, months-old number would restart the
 * warm-up clock at day 0 and suddenly throttle it, which is the opposite of what warm-up is for.
 * An already-linked session is back-dated straight past WARMUP_DONE_DAYS instead.
 */
export function recordFirstConnect(session: string, wasAlreadyLinked: boolean): void {
  const exists = db.prepare('SELECT 1 FROM wa_session_meta WHERE session = ?').get(session);
  if (exists) return;
  const firstConnectedAt = wasAlreadyLinked ? addDays(nowLocal(), -(WARMUP_DONE_DAYS + 1)) : nowLocal();
  db.prepare('INSERT INTO wa_session_meta (session, first_connected_at) VALUES (?, ?)').run(session, firstConnectedAt);
}

function daysSinceFirstConnect(session: string): number {
  const row = db.prepare('SELECT first_connected_at FROM wa_session_meta WHERE session = ?').get(session) as
    | { first_connected_at: string }
    | undefined;
  // No row yet (recordFirstConnect() hasn't run, e.g. this ran before the socket ever opened) -
  // treat as fully warmed up rather than clamping everything to the strictest stage by default.
  if (!row) return WARMUP_DONE_DAYS;
  const ms = parseWall(nowLocal()).getTime() - parseWall(row.first_connected_at).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function warmupFactor(session: string): number {
  const days = daysSinceFirstConnect(session);
  for (const stage of WARMUP_STAGES) {
    if (days <= stage.maxDays) return stage.factor;
  }
  return 1;
}

function effectiveCap(category: SendCategory, session: string): number {
  const base = category === 'proactive' ? env.wa.maxDailyProactiveMessages : env.wa.maxDailyColdMessages;
  if (base <= 0) return Infinity; // 0 = uncapped, explicit opt-out
  return Math.max(1, Math.round(base * warmupFactor(session)));
}

function countSince(category: SendCategory, sinceWall: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM wa_send_log WHERE category = ? AND sent_at >= ?')
    .get(category, sinceWall) as { n: number };
  return row.n;
}

function lastSentAt(category: SendCategory): string | undefined {
  const row = db
    .prepare('SELECT sent_at FROM wa_send_log WHERE category = ? ORDER BY sent_at DESC LIMIT 1')
    .get(category) as { sent_at: string } | undefined;
  return row?.sent_at;
}

export type BudgetCheck = { ok: true } | { ok: false; reason: string };

/**
 * Checks whether a send of this category is currently allowed, WITHOUT recording it - call this
 * right before sending, then recordSend() only after the send actually succeeds (a check that
 * passes but is never followed by a real send must not consume budget).
 */
export function checkBudget(category: SendCategory, session: string): BudgetCheck {
  const cap = effectiveCap(category, session);
  if (cap === Infinity) return { ok: true };

  const usedToday = countSince(category, `${todayLocal()} 00:00:00`);
  if (usedToday >= cap) {
    const days = daysSinceFirstConnect(session);
    const warmupNote =
      days < WARMUP_DONE_DAYS
        ? ` (número todavía en calentamiento, día ${days + 1}/${WARMUP_DONE_DAYS} - el límite sube automáticamente)`
        : '';
    return {
      ok: false,
      reason: `Se alcanzó el límite diario de mensajes ${category === 'cold' ? 'a números nuevos' : 'automáticos'} (${cap}/día)${warmupNote}.`,
    };
  }

  if (category === 'cold') {
    const last = lastSentAt('cold');
    if (last) {
      const elapsedMs = parseWall(nowLocal()).getTime() - parseWall(last).getTime();
      if (elapsedMs < COLD_MIN_INTERVAL_MS) {
        return { ok: false, reason: 'Vas muy seguido escribiéndole a números nuevos - espera unos segundos entre uno y otro.' };
      }
    }
  }

  return { ok: true };
}

/** Records a send that actually went out - only call after a successful sock.sendMessage(). */
export function recordSend(category: SendCategory, jid: string): void {
  db.prepare('INSERT INTO wa_send_log (category, jid, sent_at) VALUES (?, ?, ?)').run(category, jid, nowLocal());
  // Keep the log small - only ever queried for "since start of today", nothing needs rows older
  // than a couple of days, but a short buffer is kept for the admin-panel stats view.
  db.prepare("DELETE FROM wa_send_log WHERE sent_at < ?").run(addDays(nowLocal(), -7));
}

/** JSON has no Infinity (serializes to null, which the panel would have to special-case) - -1 is
 *  the "uncapped" sentinel over the wire instead, matched by the admin panel's own check. */
function capForWire(cap: number): number {
  return Number.isFinite(cap) ? cap : -1;
}

/** Snapshot for the admin panel (see /api/connection/status) - lets the admin actually SEE the
 *  safety net working instead of just trusting it's there. */
export function stats(session: string): {
  daysSinceFirstConnect: number;
  warmupDone: boolean;
  proactive: { usedToday: number; cap: number };
  cold: { usedToday: number; cap: number };
} {
  const days = daysSinceFirstConnect(session);
  return {
    daysSinceFirstConnect: days,
    warmupDone: days >= WARMUP_DONE_DAYS,
    proactive: {
      usedToday: countSince('proactive', `${todayLocal()} 00:00:00`),
      cap: capForWire(effectiveCap('proactive', session)),
    },
    cold: { usedToday: countSince('cold', `${todayLocal()} 00:00:00`), cap: capForWire(effectiveCap('cold', session)) },
  };
}
