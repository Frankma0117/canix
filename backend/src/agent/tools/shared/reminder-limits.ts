/** Shared limits for kind='interval' reminders - used by both schedule-interval-reminder.tool.ts
 *  (creation) and edit-reminder.tool.ts (editing), so the two can't silently drift apart. */
export const MIN_INTERVAL_SECONDS = 20; // below this it wouldn't reliably fire more often than the scheduler's own 30s tick anyway
export const MAX_REPEAT_COUNT = 100; // safety ceiling against an accidentally-infinite spam loop
