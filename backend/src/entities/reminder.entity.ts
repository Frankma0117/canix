// 'missed': was due while the process was down (crash/restart/deploy) and deliberately NOT sent
// on recovery, instead of dumping the whole backlog at once - see reconcileMissedReminders() in
// task-scheduler.ts. 'suspended': a recurring/repeating notification that went unconfirmed for too
// long (see needsConfirmation() in task-scheduler.ts) - silenced until the user writes anything at
// all, which auto-resumes it (remindersModel.confirmForUser()).
export type ReminderStatus = 'pending' | 'executed' | 'failed' | 'cancelled' | 'missed' | 'suspended';

export type RecurrenceFreq = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export type ReminderKind =
  | 'reminder'
  | 'important_date'
  | 'flexible'
  | 'routine_reminder'
  | 'routine_checkin'
  // DEPRECATED - no longer auto-created (used to be a daily unsolicited "agenda del día" push,
  // one per user, fired at MORNING_SUMMARY_TIME). Removed per the user's own ask: no proactive
  // messaging beyond notifications the user actually scheduled themselves - see the boot migration
  // in database/migrate.ts that cancels any pre-existing ones. The on-demand get_today_agenda tool
  // (services/agenda/agenda.service.ts's buildAgendaMessage) still works exactly the same, only the auto-push is gone.
  // Kind kept in the type only so old rows/history still type-check.
  | 'daily_agenda'
  // One per user, auto-created on bootstrap/grant_access: fires weekly (WEEKLY_REPORT_DAY/TIME).
  // Same "ignore stored message, build fresh at send time" pattern as daily_agenda - see
  // services/agenda/weekly-report.service.ts.
  | 'weekly_report'
  // Short-cycle repeating alert (e.g. "avísame cada 30s, 5 veces, para cambiar de serie") - see
  // interval_seconds/repeat_count/fired_count below and schedule-interval-reminder.tool.ts. Stop
  // it early with cancel_reminder/delete_reminder like any other pending reminder. NOT pausable
  // (see pause-reminder.tool.ts) - a short-cycle timer has no sensible "resume days later" meaning.
  | 'interval'
  // One per user, auto-created on bootstrap/grant_access: silently clears that day's conversation
  // history (messages table only - never touches todos/reminders/etc.) once a day at
  // DAILY_RESET_TIME. Never sends a WhatsApp message - see services/conversation/daily-reset.service.ts.
  | 'daily_reset'
  // One per user, auto-created on bootstrap/grant_access: silently merges/removes duplicate
  // routines and reminders once a day at DAILY_DEDUP_TIME. Never sends a WhatsApp message - see
  // services/maintenance/dedup.service.ts.
  | 'daily_dedup'
  // A dose of a medication / vitamin / cream (medication_id) - see services/medications/.
  | 'medication'
  // A planned meal with a time (meal_plan_id): the meal itself, and "toca preparar" before it.
  | 'meal'
  | 'meal_prep';

export interface Reminder {
  id: number;
  user_id: number;
  // Set only for the reminder_time / checkin pair auto-created by a routine (kind
  // 'routine_reminder' / 'routine_checkin') - deleting the routine cascades and removes both.
  todo_id: number | null;
  // Optional reference to a saved link (see save_link/list_links) - lets a reminder point at
  // "haz el ejercicio de tal link" without repeating the URL in the message.
  link_id: number | null;
  // Owner of kind 'medication' / 'meal' / 'meal_prep' rows - deleting it removes them.
  medication_id: number | null;
  meal_plan_id: number | null;
  message: string;
  run_at: string; // 'YYYY-MM-DD HH:mm:ss' local time, next fire time
  target_jid: string | null; // null = owner
  category_id: number | null;
  recurrence_freq: RecurrenceFreq;
  recurrence_interval: number;
  status: ReminderStatus;
  kind: ReminderKind;
  // Only set for kind === 'flexible': run_at's time is re-randomized within this 'HH:mm' window
  // on every recurrence instead of repeating at the same clock time (see task-scheduler.ts).
  window_start: string | null;
  window_end: string | null;
  // Only used for kind === 'interval': how many seconds between each fire, and the total number of
  // times to fire before stopping on its own (fired_count tracks progress - see task-scheduler.ts).
  interval_seconds: number | null;
  repeat_count: number | null;
  fired_count: number;
  // Only used for kind === 'interval': also send a local-TTS voice note alongside the text on each
  // fire (no AI/tokens - see services/audio/tts.ts). Silently a no-op if Piper isn't configured.
  with_audio: number;
  // Set = this specific reminder is silenced until this moment (see pause-reminder.tool.ts /
  // pause-routine.tool.ts). NULL = not paused. A user-level pause (users.paused_until) also
  // silences this row even when this column itself is NULL - see task-scheduler.ts.
  paused_until: string | null;
  // 1 right after a needsConfirmation() reminder was sent and the user hasn't written anything
  // (any message at all) since - cleared the moment they do (remindersModel.confirmForUser(), called
  // from every inbound message). See task-scheduler.ts's confirmation gate.
  awaiting_confirmation: number;
  // How many times in a row this fired while still awaiting_confirmation from the previous send -
  // reaching the limit auto-suspends it (status 'suspended') instead of sending again. Reset to 0
  // the moment the user writes anything.
  missed_confirmations: number;
  created_at: string;
}

/** Row shape of remindersModel.listDue()'s join - the owning user's pause state alongside the
 *  reminder's own, so task-scheduler.ts can check both without an extra query per reminder. */
export interface DueReminder extends Reminder {
  user_paused_until: string | null;
}
