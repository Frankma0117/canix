import { stripKnownPrefix } from '../shared/utils/motivational.js';
import { remindersModel } from '../models/reminders.model.js';
import { usersModel } from '../models/users.model.js';
import { messagesModel } from '../models/messages.model.js';
import { processDueCallReminders } from '../services/calls/call-reminders.service.js';
import { processSchedulingTick } from '../services/scheduling/scheduling.service.js';
import { nowLocal, addMinutes, addMonths, addDays, addSeconds, dateOnly, randomTimeOnDate } from '../shared/utils/datetime.js';
import { buildWeeklyReportMessage } from '../services/agenda/weekly-report.service.js';
import { dedupeUser, summaryTotal, summaryLine } from '../services/maintenance/dedup.service.js';
import { nextRoutineRunAt } from '../services/routines/routine-setup.service.js';
import { nextMedicationRunAt } from '../services/medications/medications.service.js';
import { sendReminderWithPrompt } from '../services/reminders/reminder-prompts.service.js';
import { todosModel } from '../models/todos.model.js';
import { checkBudget, recordSend } from '../channels/whatsapp/send-guard.js';
import { env } from '../config/env.js';
import { synthesizeVoiceNote } from '../services/audio/tts.js';
import { can } from '../services/permissions/permissions.service.js';
import { sleep } from '../shared/utils/human-delay.js';
import type { WaManager } from '../channels/whatsapp/wa-manager.js';
import type { Reminder, DueReminder } from '../entities/index.js';

/** Small pause between reminder sends within the same tick - without it, a tick where several
 *  reminders happen to fall due at once (e.g. many users' daily agenda all firing around the same
 *  hour) fires that whole burst of WhatsApp sends back to back with zero spacing, which is exactly
 *  the kind of "unusual traffic pattern" that increases account-review risk. Same reasoning already
 *  used for announce_update's per-recipient pause (see announce-update.tool.ts). Kept short since a
 *  tick can have several genuinely due reminders and none of this should visibly delay any one of
 *  them by much. */
const BETWEEN_SENDS_MS = 350;

/** Computes the next run_at for a recurring reminder. */
function nextRunAt(reminder: Reminder): string | undefined {
  const { recurrence_freq, recurrence_interval, run_at, kind, window_start, window_end } = reminder;

  // A routine's own schedule (certain weekdays, every N weeks, monthly...) decides its next
  // occurrence - see services/routines/routine-schedule.ts.
  if (kind === 'routine_reminder' || kind === 'routine_checkin') {
    const next = nextRoutineRunAt(reminder);
    if (next) return next;
  }

  // A medication's next dose follows its own schedule (weekdays, end of treatment).
  if (kind === 'medication') return nextMedicationRunAt(reminder);

  // Flexible reminders (e.g. "pausa activa entre 3pm y 5pm") don't repeat at the same clock time -
  // each occurrence gets a fresh random time within its window, so it doesn't feel mechanical.
  if (kind === 'flexible' && window_start && window_end && recurrence_freq === 'daily') {
    const nextDate = dateOnly(addDays(run_at, recurrence_interval));
    return randomTimeOnDate(nextDate, window_start, window_end);
  }

  switch (recurrence_freq) {
    case 'daily':
      return addMinutes(run_at, 60 * 24 * recurrence_interval);
    case 'weekly':
      return addMinutes(run_at, 60 * 24 * 7 * recurrence_interval);
    case 'monthly':
      return addMonths(run_at, recurrence_interval);
    case 'yearly':
      return addMonths(run_at, 12 * recurrence_interval);
    default:
      return undefined; // 'none'
  }
}

/** True for kinds that repeat on a schedule (including the "ignore stored message, build fresh"
 *  system kinds) - these get silently fast-forwarded past a pause instead of firing late/backlogged
 *  on resume (see the pause-skip block in tick() below). */
function isRecurringKind(reminder: Reminder): boolean {
  return (
    reminder.recurrence_freq !== 'none' ||
    reminder.kind === 'routine_reminder' ||
    reminder.kind === 'routine_checkin' ||
    reminder.kind === 'medication' ||
    reminder.kind === 'daily_agenda' ||
    reminder.kind === 'weekly_report' ||
    reminder.kind === 'daily_reset' ||
    reminder.kind === 'daily_dedup'
  );
}

/**
 * Core fast-forward loop shared by advancePastPause() and the other callers below: walks a
 * recurring reminder's run_at forward, occurrence by occurrence, until it lands strictly after
 * `threshold` - never sending anything along the way. Capped as a runaway guard against a
 * pathological (very tight recurrence + very long gap) combination, in which case it just returns
 * the threshold itself as a good-enough landing spot; the next tick moves it along normally from
 * there. Returns `{ terminal: true }` if the chain has nowhere left to go (recurrence_freq 'none' -
 * only possible here for a kind that's normally recurring but got edited down to a one-off mid
 * chain; every caller treats this as "nothing sensible to reschedule to").
 */
function fastForwardPast(reminder: Reminder, threshold: string): { runAt: string } | { terminal: true } {
  let current: Reminder = reminder;
  for (let i = 0; i < 500; i++) {
    const next = nextRunAt(current);
    if (!next) return { terminal: true };
    if (next > threshold) return { runAt: next };
    current = { ...current, run_at: next };
  }
  return { runAt: threshold };
}

/**
 * Fast-forwards a recurring reminder's run_at past a pause window, silently (no send) - so
 * unpausing doesn't dump a backlog of missed occurrences; the next fire is just the next natural
 * occurrence after resume, exactly as if nothing happened during the pause.
 */
function advancePastPause(reminder: Reminder, pausedUntil: string): void {
  const forward = fastForwardPast(reminder, pausedUntil);
  if ('terminal' in forward) remindersModel.markStatus(reminder.id, 'executed');
  else remindersModel.reschedule(reminder.id, forward.runAt);
}

/**
 * True for the notification kinds that require a confirming reply (any inbound message at all,
 * not necessarily on-topic - see reminders.model.ts's confirmForUser()) before they're allowed to
 * fire again: recurring plain reminders/flexible/important-date, routines, and the weekly report -
 * anything that would otherwise keep pushing messages indefinitely into a chat that's gone quiet,
 * which is exactly the one-way-broadcast pattern that gets WhatsApp numbers flagged. Deliberately
 * EXCLUDES: one-off (non-recurring) reminders (nothing "next" to gate), 'interval' (a short, self-
 * terminating burst the user just triggered seconds ago - already bounded, not a standing
 * subscription), and the silent maintenance kinds (never send a message to confirm in the first
 * place). See the suspend/resume flow in tick() below.
 */
function needsConfirmation(reminder: Reminder): boolean {
  if (reminder.kind === 'routine_reminder' || reminder.kind === 'routine_checkin' || reminder.kind === 'weekly_report' || reminder.kind === 'medication') {
    return true;
  }
  return (
    (reminder.kind === 'reminder' || reminder.kind === 'flexible' || reminder.kind === 'important_date') &&
    reminder.recurrence_freq !== 'none'
  );
}

/** How many consecutive unconfirmed sends a notification gets before it's auto-suspended (see
 *  needsConfirmation() above) - one full miss is tolerated (people get busy for a day), suspending
 *  only once a SECOND one in a row also goes unanswered. */
const CONFIRMATION_MISS_LIMIT = 2;

/**
 * One-time reconciliation run once at boot, before the scheduler starts ticking normally (see
 * index.ts) - reminders that are already 'pending' with run_at in the past at this exact moment
 * were, by definition, due at some point while the process wasn't running (crash, deploy, manual
 * restart). Sending all of those now, in one burst right as the WhatsApp session reconnects, is
 * both a bad experience (a pile of stale reminders) and exactly the kind of "unusual traffic
 * pattern" that increases account-review risk. So instead: recurring ones are silently fast-
 * forwarded to their next real future occurrence (same as a pause - see advancePastPause above),
 * and one-off ones (nothing to fast-forward to) are marked 'missed' without ever being sent. If the
 * admin wants to actually tell people the bot's back, that's a deliberate, explicit action on their
 * part (send_message / announce_update), never automatic.
 */
export function reconcileMissedReminders(): void {
  const now = nowLocal();
  const due = remindersModel.listDue(now);
  let rescheduled = 0;
  let missed = 0;

  for (const reminder of due) {
    // Silent maintenance kinds never send anything - safe to just let the first normal tick
    // process them like any other day.
    if (reminder.kind === 'daily_reset' || reminder.kind === 'daily_dedup') continue;

    if (isRecurringKind(reminder)) {
      const forward = fastForwardPast(reminder, now);
      if ('terminal' in forward) {
        remindersModel.markStatus(reminder.id, 'missed');
        missed++;
      } else {
        remindersModel.reschedule(reminder.id, forward.runAt);
        rescheduled++;
      }
    } else {
      // One-off reminder or an 'interval' mid-burst - no sensible "next" occurrence to move to,
      // and stale interval math (elapsed seconds while the process was down) isn't worth chasing.
      remindersModel.markStatus(reminder.id, 'missed');
      missed++;
    }
  }

  if (rescheduled > 0 || missed > 0) {
    console.log(
      '[SCHEDULER] Startup reconciliation: %d overdue reminder(s) rescheduled, %d marked as missed (not sent).',
      rescheduled,
      missed,
    );
  }
}

/** Later of two possibly-null pause timestamps ('YYYY-MM-DD HH:mm:ss'), or null if neither is set. */
function maxPause(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * Periodically checks for due reminders and sends them over WhatsApp.
 * Recurring reminders get rescheduled to their next occurrence instead of
 * being marked executed for good.
 */
export class TaskScheduler {
  private timer: NodeJS.Timeout | undefined;
  // Guards against overlapping ticks: if a send is slow (many due reminders, a network hiccup)
  // and takes longer than intervalMs, setInterval fires again anyway - without this flag both
  // ticks would fetch the same still-'pending' reminder and send it twice. This was the main
  // cause of a reminder occasionally going out 2-3 times.
  private running = false;

  constructor(
    private wa: WaManager,
    private intervalMs = 30_000,
  ) {}

  start(): void {
    console.log('[SCHEDULER] Started (every %ss).', this.intervalMs / 1000);
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return; // previous tick still in flight - never process the same due set twice
    this.running = true;

    try {
      // Phone-call reminders (Twilio Programmable Voice, see services/calls/call-reminders.service.ts) -
      // reuses this same tick/interval instead of a second worker, but runs regardless of the
      // WhatsApp connection state below: a call reminder has nothing to do with the WA session,
      // and shouldn't wait on it (or on WhatsApp reminder processing) either way. A failure here
      // is caught and logged, never allowed to skip the WhatsApp reminders that follow.
      try {
        await processDueCallReminders();
      } catch (err) {
        console.error('[SCHEDULER] Error processing call reminders:', (err as Error).message);
      }

      if (!this.wa.isConnected()) return; // WhatsApp reminders retried on the next tick once connected

      // Appointment reminders / expiring unconfirmed requests (see services/scheduling/scheduling.service.ts) - its own
      // try so a failure there never blocks the regular reminders below.
      try {
        await processSchedulingTick();
      } catch (err) {
        console.error('[SCHEDULER] Error processing the appointment agenda:', (err as Error).message);
      }

      let due: DueReminder[];
      try {
        due = remindersModel.listDue(nowLocal());
      } catch (err) {
        console.error('[SCHEDULER] Error querying reminders:', (err as Error).message);
        return;
      }

      const nowWall = nowLocal();

      for (const reminder of due) {
        // A pause (user-level or on this specific reminder/routine - see pause-notifications.tool.ts
        // / pause-reminder.tool.ts / pause-routine.tool.ts) silences it until the later of the two.
        // Recurring items get silently fast-forwarded past the pause (no backlog on resume, see
        // advancePastPause's comment); one-off items just sit pending and fire on the first tick
        // once the pause lifts, preserving their single occurrence instead of losing/relocating it.
        const effectivePause = maxPause(reminder.paused_until, reminder.user_paused_until);
        if (effectivePause && effectivePause > nowWall) {
          if (isRecurringKind(reminder)) advancePastPause(reminder, effectivePause);
          continue;
        }

        const target = reminder.target_jid;
        if (!target) continue;

        if (reminder.kind === 'daily_reset' || reminder.kind === 'daily_dedup') {
          await this.handleSilentMaintenance(reminder);
          continue;
        }

        if (reminder.kind === 'interval') {
          await this.handleIntervalReminder(reminder, target);
          await sleep(BETWEEN_SENDS_MS);
          continue;
        }

        // A routine's check-in ("¿Ya hiciste tu rutina?") is never sent: it landed at notice time +
        // duration - the same minute for routines without one, 5-10 min later otherwise - so every
        // routine arrived twice, both asking for the same 👍/👎. The notice alone carries that
        // footer. The row itself stays (pause/edit/delete move the routine's pair together, see
        // routine-setup.service.ts); it's just moved along silently.
        if (reminder.kind === 'routine_checkin') {
          const next = nextRunAt(reminder);
          if (next) remindersModel.reschedule(reminder.id, next);
          else remindersModel.markStatus(reminder.id, 'executed');
          continue;
        }

        // Confirmation gate (see needsConfirmation()'s comment): if the LAST send of this exact
        // notification is still awaiting a reply and this would be its second such send in a row,
        // suspend it instead - a suspension notice, not the normal message, goes out this time.
        if (needsConfirmation(reminder) && reminder.awaiting_confirmation) {
          const missedAfter = reminder.missed_confirmations + 1;
          if (missedAfter >= CONFIRMATION_MISS_LIMIT) {
            await this.suspendForNoConfirmation(reminder, target);
            continue;
          }
        }

        // Daily send-volume governor (see channels/whatsapp/send-guard.ts) - a last line of defense against
        // a runaway loop or misconfiguration pushing an unusual volume of proactive messages in one
        // day. Checked BEFORE committing the reschedule below so a capped reminder just stays due
        // and gets retried on a later tick once budget frees up (past midnight, or the admin raises
        // MAX_DAILY_PROACTIVE_MESSAGES) instead of being silently lost.
        const budget = checkBudget('proactive', env.wa.session);
        if (!budget.ok) {
          console.error('[SCHEDULER] Reminder #%d held back: %s', reminder.id, budget.reason);
          continue;
        }

        const next = nextRunAt(reminder);
        try {
          // Commit the state transition BEFORE sending: if the process crashes/restarts in the
          // gap between a successful send and this write, a reminder left 'pending' with run_at
          // in the past would resend (and duplicate) on the next boot's first tick. Writing first
          // means a crash can at most *skip* a resend, never repeat one - a much better trade-off
          // than the duplicate-message complaint this used to cause.
          if (next) remindersModel.reschedule(reminder.id, next);
          else remindersModel.markStatus(reminder.id, 'executed');

          // kind 'weekly_report' ignores its stored `message` and builds the real content fresh at
          // send time (see services/agenda/weekly-report.service.ts) - it must reflect whatever changed
          // since the reminder was created, not a stale snapshot.
          // Everything else goes out formatted (lead-in, the thing itself in bold, details) and, when
          // it's something to confirm, with the 👍/👎 reaction footer - see
          // services/reminders/reminder-prompts.service.ts.
          let sent = 1;
          if (reminder.kind === 'weekly_report') await this.wa.sendText(target, buildWeeklyReportMessage(reminder.user_id));
          else sent = await sendReminderWithPrompt(this.wa, reminder, target);
          for (let i = 0; i < sent; i++) recordSend('proactive', target);
          console.log('[SCHEDULER] Reminder #%d sent to %s.', reminder.id, target);

          // Now that it actually went out, start/continue tracking whether it gets confirmed - see
          // needsConfirmation()'s comment and the gate above.
          if (needsConfirmation(reminder)) {
            const missedNow = reminder.awaiting_confirmation ? reminder.missed_confirmations + 1 : 0;
            remindersModel.setConfirmationState(reminder.id, true, missedNow);
          }

          await sleep(BETWEEN_SENDS_MS);
        } catch (err) {
          console.error('[SCHEDULER] Reminder #%d failed:', reminder.id, (err as Error).message);
          // Best-effort only: a one-off reminder gets marked failed so it's visible; a recurring
          // one was already moved to its next occurrence above, which just means this particular
          // occurrence is skipped rather than risking a duplicate by retrying it here.
          if (!next) remindersModel.markStatus(reminder.id, 'failed');
        }
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Handles the two silent internal-housekeeping kinds (daily_reset, daily_dedup - see
   * services/conversation/daily-reset.service.ts / services/maintenance/dedup.service.ts): reschedule to the next day, then do the DB work.
   * Deliberately sends NO WhatsApp message - these are purely internal chores, not user-facing
   * notifications (see this feature's own design: silent by request).
   */
  private async handleSilentMaintenance(reminder: Reminder): Promise<void> {
    const next = nextRunAt(reminder);
    if (next) remindersModel.reschedule(reminder.id, next);
    else remindersModel.markStatus(reminder.id, 'executed');

    if (reminder.kind === 'daily_reset') {
      messagesModel.clear(reminder.user_id);
      console.log('[SCHEDULER] Conversation history reset for user #%d.', reminder.user_id);
    } else if (reminder.kind === 'daily_dedup') {
      const summary = await dedupeUser(reminder.user_id);
      if (summaryTotal(summary) > 0) {
        console.log('[SCHEDULER] User #%d: %s.', reminder.user_id, summaryLine(summary));
      }
    }
  }

  /**
   * Handles a kind='interval' reminder (see schedule-interval-reminder.tool.ts): unlike the
   * daily/weekly/etc. recurrence system, this one manages its own short cadence and stops itself
   * once repeat_count is reached. Same write-before-send ordering as the main loop, for the same
   * crash-safety reason (see the comment above in tick()).
   */
  private async handleIntervalReminder(reminder: Reminder, target: string): Promise<void> {
    const budget = checkBudget('proactive', env.wa.session);
    if (!budget.ok) {
      console.error('[SCHEDULER] Interval reminder #%d held back: %s', reminder.id, budget.reason);
      return; // stays at its current run_at, retried on a later tick like the main loop's own gate
    }

    const firedCountAfter = reminder.fired_count + 1;
    const done = !reminder.repeat_count || firedCountAfter >= reminder.repeat_count;
    const next = done ? null : addSeconds(reminder.run_at, reminder.interval_seconds ?? 30);

    try {
      remindersModel.advanceInterval(reminder.id, next);

      const counter = reminder.repeat_count ? `${firedCountAfter}/${reminder.repeat_count}` : `${firedCountAfter}`;
      const closing = done ? ' ✅ ¡Listo, terminaste!' : '';
      const text = `🔁 ${counter} — ${reminder.message}${closing}`;

      await this.wa.sendText(target, text);
      recordSend('proactive', target);
      console.log('[SCHEDULER] Interval reminder #%d sent to %s (%s).', reminder.id, target, counter);

      if (reminder.with_audio) {
        const owner = usersModel.getById(reminder.user_id);
        const voice = await synthesizeVoiceNote(text, owner?.voice_gender, {
          premium: can(owner, 'voice.premium'),
          userId: reminder.user_id,
          voiceId: owner?.voice_id,
        }).catch(() => null);
        if (voice) await this.wa.sendAudio(target, voice).catch(() => {});
      }
    } catch (err) {
      console.error('[SCHEDULER] Interval reminder #%d failed:', reminder.id, (err as Error).message);
      if (done) remindersModel.markStatus(reminder.id, 'failed');
    }
  }

  /**
   * Suspends a notification that went CONFIRMATION_MISS_LIMIT sends without a reply, instead of
   * sending it again - see needsConfirmation()'s comment and the gate in tick(). A routine's two
   * linked rows (routine_reminder + routine_checkin, same todo_id) are suspended together so the
   * whole routine goes quiet at once rather than half of it still pinging. Never mentions ban risk
   * to the user - just that there's been no reply, and that writing anything brings it back.
   */
  private async suspendForNoConfirmation(reminder: DueReminder, target: string): Promise<void> {
    const isRoutine = reminder.kind === 'routine_reminder' || reminder.kind === 'routine_checkin';
    const linked = isRoutine && reminder.todo_id ? remindersModel.listByTodo(reminder.todo_id) : [reminder];

    for (const r of linked) {
      if (r.status !== 'pending') continue;
      const forward = fastForwardPast(r, nowLocal());
      if ('terminal' in forward) {
        remindersModel.markStatus(r.id, 'executed');
      } else {
        remindersModel.suspendForNoConfirmation(r.id, forward.runAt);
      }
    }

    const routineTitle = isRoutine && reminder.todo_id ? todosModel.getById(reminder.user_id, reminder.todo_id)?.title : undefined;
    const label = isRoutine ? `tu rutina "${routineTitle ?? stripKnownPrefix(reminder.message)}"` : `"${stripKnownPrefix(reminder.message)}"`;
    const notice =
      `⏸️ Voy a dejar en pausa ${label} porque no he tenido respuesta tuya desde los últimos avisos. ` +
      'Escríbeme cualquier cosa cuando quieras y se reactiva sola.';
    try {
      await this.wa.sendText(target, notice);
      console.log('[SCHEDULER] Reminder #%d suspended for lack of confirmation.', reminder.id);
    } catch (err) {
      console.error('[SCHEDULER] Could not announce the suspension of #%d:', reminder.id, (err as Error).message);
    }
    await sleep(BETWEEN_SENDS_MS);
  }
}
