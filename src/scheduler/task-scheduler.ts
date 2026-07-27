import { remindersRepo } from '../db/repositories/reminders.repo.js';
import { nowLocal, addMinutes, addMonths, addDays, dateOnly, randomTimeOnDate } from '../util/datetime.js';
import type { WaManager } from '../whatsapp/wa-manager.js';
import type { Reminder } from '../types/index.js';

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

/**
 * Periodically checks for due reminders and sends them over WhatsApp.
 * Recurring reminders get rescheduled to their next occurrence instead of
 * being marked executed for good.
 */
export class TaskScheduler {
  private timer: NodeJS.Timeout | undefined;

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
    if (!this.wa.isConnected()) return; // retried on the next tick once connected

    let due: Reminder[];
    try {
      due = remindersRepo.listDue(nowLocal());
    } catch (err) {
      console.error('[SCHEDULER] Error consultando recordatorios:', (err as Error).message);
      return;
    }

    for (const reminder of due) {
      try {
        const target = reminder.target_jid;
        if (!target) continue;
        // Plain reminders get a generic ⏰ prefix; every other kind already carries its own
        // emoji/wording at creation time (important_date, flexible, routine_reminder/checkin -
        // see schedule-important-date.tool.ts, schedule-flexible-reminder.tool.ts, routine-setup.ts).
        const prefix = reminder.kind === 'reminder' ? '⏰ ' : '';
        await this.wa.sendText(target, `${prefix}${reminder.message}`);
        console.log('[SCHEDULER] Recordatorio #%d enviado a %s.', reminder.id, target);

        const next = nextRunAt(reminder);
        if (next) remindersRepo.reschedule(reminder.id, next);
        else remindersRepo.markStatus(reminder.id, 'executed');
      } catch (err) {
        console.error('[SCHEDULER] Recordatorio #%d falló:', reminder.id, (err as Error).message);
        remindersRepo.markStatus(reminder.id, 'failed');
      }
    }
  }
}
