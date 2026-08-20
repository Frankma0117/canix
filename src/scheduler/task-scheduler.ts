import { remindersRepo } from '../db/repositories/reminders.repo.js';
import { habitLogsRepo } from '../db/repositories/habit-logs.repo.js';
import { messagesRepo } from '../db/repositories/messages.repo.js';
import { stickersRepo } from '../db/repositories/stickers.repo.js';
import { processDueCallReminders } from '../calls/call-reminders.service.js';
import { nowLocal, addMinutes, addMonths, addDays, addSeconds, dateOnly, randomTimeOnDate } from '../util/datetime.js';
import { buildAgendaMessage } from '../agent/agenda.js';
import { buildWeeklyReportMessage } from '../agent/weekly-report.js';
import { dedupeUser } from '../agent/dedup.js';
import { plainReminderPrefix } from '../util/motivational.js';
import { synthesizeVoiceNote } from '../audio/tts.js';
import type { WaManager } from '../whatsapp/wa-manager.js';
import type { Reminder, DueReminder } from '../types/index.js';

/** Computes the next run_at for a recurring reminder. */
function nextRunAt(reminder: Reminder): string | undefined {
  const { recurrence_freq, recurrence_interval, run_at, kind, window_start, window_end } = reminder;

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
    reminder.kind === 'daily_agenda' ||
    reminder.kind === 'weekly_report' ||
    reminder.kind === 'daily_reset' ||
    reminder.kind === 'daily_dedup'
  );
}

/**
 * Fast-forwards a recurring reminder's run_at past a pause window, silently (no send) - so
 * unpausing doesn't dump a backlog of missed occurrences; the next fire is just the next natural
 * occurrence after resume, exactly as if nothing happened during the pause. Capped as a runaway
 * guard against a pathological pause length + tight recurrence combination.
 */
function advancePastPause(reminder: Reminder, pausedUntil: string): void {
  let current: Reminder = reminder;
  for (let i = 0; i < 500; i++) {
    const next = nextRunAt(current);
    if (!next) {
      remindersRepo.markStatus(current.id, 'executed');
      return;
    }
    if (next > pausedUntil) {
      remindersRepo.reschedule(current.id, next);
      return;
    }
    current = { ...current, run_at: next };
  }
  // Pathological case (very tight recurrence + very long pause) - just park it right at the
  // pause's end instead of looping further; the next tick will move it along normally from there.
  remindersRepo.reschedule(current.id, pausedUntil);
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
    console.log('[SCHEDULER] Iniciado (cada %ss).', this.intervalMs / 1000);
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
      // Phone-call reminders (Twilio Programmable Voice, see calls/call-reminders.service.ts) -
      // reuses this same tick/interval instead of a second worker, but runs regardless of the
      // WhatsApp connection state below: a call reminder has nothing to do with the WA session,
      // and shouldn't wait on it (or on WhatsApp reminder processing) either way. A failure here
      // is caught and logged, never allowed to skip the WhatsApp reminders that follow.
      try {
        await processDueCallReminders();
      } catch (err) {
        console.error('[SCHEDULER] Error procesando recordatorios de llamada:', (err as Error).message);
      }

      if (!this.wa.isConnected()) return; // WhatsApp reminders retried on the next tick once connected

      let due: DueReminder[];
      try {
        due = remindersRepo.listDue(nowLocal());
      } catch (err) {
        console.error('[SCHEDULER] Error consultando recordatorios:', (err as Error).message);
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
          continue;
        }

        // A routine check-in whose habit was already marked done for the day (e.g. the user did
        // it early and called checkin_routine before this reminder was due) shouldn't ask again -
        // just move it along silently instead of re-asking a question that's already answered.
        if (reminder.kind === 'routine_checkin' && reminder.todo_id) {
          const log = habitLogsRepo.getForDate(reminder.todo_id, dateOnly(reminder.run_at));
          if (log?.done) {
            const next = nextRunAt(reminder);
            if (next) remindersRepo.reschedule(reminder.id, next);
            else remindersRepo.markStatus(reminder.id, 'executed');
            console.log(
              '[SCHEDULER] Chequeo #%d omitido (rutina #%d ya marcada el %s).',
              reminder.id,
              reminder.todo_id,
              dateOnly(reminder.run_at),
            );
            continue;
          }
        }

        const next = nextRunAt(reminder);
        try {
          // Commit the state transition BEFORE sending: if the process crashes/restarts in the
          // gap between a successful send and this write, a reminder left 'pending' with run_at
          // in the past would resend (and duplicate) on the next boot's first tick. Writing first
          // means a crash can at most *skip* a resend, never repeat one - a much better trade-off
          // than the duplicate-message complaint this used to cause.
          if (next) remindersRepo.reschedule(reminder.id, next);
          else remindersRepo.markStatus(reminder.id, 'executed');

          // kind 'daily_agenda'/'weekly_report' ignore their stored `message` and build the real
          // content fresh at send time (see agent/agenda.ts, agent/weekly-report.ts) - that's the
          // whole point, it must reflect whatever changed since the reminder was created, not a
          // stale snapshot.
          const text =
            reminder.kind === 'daily_agenda'
              ? buildAgendaMessage(reminder.user_id, { withIntro: true })
              : reminder.kind === 'weekly_report'
                ? buildWeeklyReportMessage(reminder.user_id)
                : // Plain reminders get a rotating warm/motivational lead-in (see util/motivational.ts) so
                // they read like a friend's nudge instead of a flat notification; every other kind
                // already carries its own emoji/wording at creation time (important_date, flexible,
                // routine_reminder/checkin - see schedule-important-date.tool.ts,
                // schedule-flexible-reminder.tool.ts, routine-setup.ts).
                `${reminder.kind === 'reminder' ? `${plainReminderPrefix()} ` : ''}${reminder.message}`;

          await this.wa.sendText(target, text);
          console.log('[SCHEDULER] Recordatorio #%d enviado a %s.', reminder.id, target);

          // Best-effort "good morning" sticker alongside the daily agenda - this push never goes
          // through the AI loop (no model turn to decide "does a sticker fit?"), so it's a plain
          // keyword match against whatever the admin actually labeled a sticker (see
          // stickers.repo.ts's findByKeywords) instead of an LLM judgment call. Silently does
          // nothing if no matching sticker exists yet.
          if (reminder.kind === 'daily_agenda') {
            const morningSticker = stickersRepo.findByKeywords(['buenos_dias', 'buen_dia', 'good_morning', 'buenosdias']);
            if (morningSticker) {
              await this.wa.sendSticker(target, morningSticker.data).catch((err) => {
                console.error('[SCHEDULER] No se pudo enviar el sticker de buenos días:', (err as Error).message);
              });
            }
          }
        } catch (err) {
          console.error('[SCHEDULER] Recordatorio #%d falló:', reminder.id, (err as Error).message);
          // Best-effort only: a one-off reminder gets marked failed so it's visible; a recurring
          // one was already moved to its next occurrence above, which just means this particular
          // occurrence is skipped rather than risking a duplicate by retrying it here.
          if (!next) remindersRepo.markStatus(reminder.id, 'failed');
        }
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Handles the two silent internal-housekeeping kinds (daily_reset, daily_dedup - see
   * agent/daily-reset.ts / agent/dedup.ts): reschedule to the next day, then do the DB work.
   * Deliberately sends NO WhatsApp message - these are purely internal chores, not user-facing
   * notifications (see this feature's own design: silent by request).
   */
  private async handleSilentMaintenance(reminder: Reminder): Promise<void> {
    const next = nextRunAt(reminder);
    if (next) remindersRepo.reschedule(reminder.id, next);
    else remindersRepo.markStatus(reminder.id, 'executed');

    if (reminder.kind === 'daily_reset') {
      messagesRepo.clear(reminder.user_id);
      console.log('[SCHEDULER] Historial de conversación reiniciado para el usuario #%d.', reminder.user_id);
    } else if (reminder.kind === 'daily_dedup') {
      const { routinesMerged, remindersRemoved } = dedupeUser(reminder.user_id);
      if (routinesMerged || remindersRemoved) {
        console.log(
          '[SCHEDULER] Usuario #%d: %d rutina(s) fusionada(s), %d recordatorio(s) duplicado(s) eliminado(s).',
          reminder.user_id,
          routinesMerged,
          remindersRemoved,
        );
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
    const firedCountAfter = reminder.fired_count + 1;
    const done = !reminder.repeat_count || firedCountAfter >= reminder.repeat_count;
    const next = done ? null : addSeconds(reminder.run_at, reminder.interval_seconds ?? 30);

    try {
      remindersRepo.advanceInterval(reminder.id, next);

      const counter = reminder.repeat_count ? `${firedCountAfter}/${reminder.repeat_count}` : `${firedCountAfter}`;
      const closing = done ? ' ✅ ¡Listo, terminaste!' : '';
      const text = `🔁 ${counter} — ${reminder.message}${closing}`;

      await this.wa.sendText(target, text);
      console.log('[SCHEDULER] Recordatorio por intervalo #%d enviado a %s (%s).', reminder.id, target, counter);

      if (reminder.with_audio) {
        const voice = await synthesizeVoiceNote(text).catch(() => null);
        if (voice) await this.wa.sendAudio(target, voice).catch(() => {});
      }
    } catch (err) {
      console.error('[SCHEDULER] Recordatorio por intervalo #%d falló:', reminder.id, (err as Error).message);
      if (done) remindersRepo.markStatus(reminder.id, 'failed');
    }
  }
}
