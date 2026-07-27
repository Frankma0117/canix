import { remindersRepo } from '../db/repositories/reminders.repo.js';
import { nowLocal, addMinutes, addMonths } from '../util/datetime.js';
import type { WaManager } from '../whatsapp/wa-manager.js';
import type { Reminder } from '../types/index.js';

/** Computes the next run_at for a recurring reminder. */
function nextRunAt(reminder: Reminder): string | undefined {
  const { recurrence_freq, recurrence_interval, run_at } = reminder;
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
        await this.wa.sendText(target, `⏰ ${reminder.message}`);
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
