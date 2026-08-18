import { remindersRepo } from '../db/repositories/reminders.repo.js';
import { todayLocal, nowLocal, addDays } from '../util/datetime.js';
import { env } from '../config/env.js';

/**
 * Creates the recurring "daily_reset" reminder for a user if they don't already have one - same
 * idempotent-bootstrap pattern as ensureDailyAgendaReminder (see agent/agenda.ts), called from the
 * same three registration points (bot-manager.ts bootstrap, grant-access.tool.ts, index.ts backfill
 * loop). Fires daily at DAILY_RESET_TIME; task-scheduler.ts handles this kind by silently clearing
 * that user's conversation history (messages table only, same narrow scope as the manual /reset
 * command) - no WhatsApp message is ever sent for this, it's purely internal housekeeping so the
 * LLM doesn't drag stale/loose context forward day after day.
 */
export function ensureDailyResetReminder(userId: number, targetJid: string): void {
  const already = remindersRepo.listAll(userId).some((r) => r.kind === 'daily_reset');
  if (already) return;

  const [h, m] = env.dailyResetTime.split(':').map(Number);
  const hh = String(h ?? 4).padStart(2, '0');
  const mm = String(m ?? 0).padStart(2, '0');
  let runAt = `${todayLocal()} ${hh}:${mm}:00`;
  if (runAt <= nowLocal()) runAt = `${addDays(todayLocal(), 1).slice(0, 10)} ${hh}:${mm}:00`;

  remindersRepo.create(userId, {
    message: 'Reinicio diario de conversación', // unused at send time - never actually sent
    runAt,
    targetJid,
    categoryId: null,
    recurrenceFreq: 'daily',
    recurrenceInterval: 1,
    kind: 'daily_reset',
  });
  console.log('[DAILY-RESET] Reinicio diario de conversación programado para el usuario #%d a las %s:%s.', userId, hh, mm);
}
