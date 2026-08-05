import { db } from './pool.js';

/**
 * Wipes everything a user owns - categories, links, contacts, reminders, todos (cascades their
 * habit_logs automatically), rewards/punishments, chat history - but keeps the user record itself
 * (their access, name, role, jid/lid), so this is a "start over" reset, not a revoke. Used by the
 * /reset todo confirmar chat command (see bot-manager.ts) - deliberately NOT exposed as an agent
 * tool, since something this destructive should never depend on the LLM deciding to call it.
 */
export function resetAllUserData(userId: number): void {
  const tx = db.transaction(() => {
    for (const table of [
      'messages',
      'rewards_punishments',
      'reminders',
      'exercises',
      'meal_plans',
      'recipes',
      'todos',
      'links',
      'contacts',
      'categories',
    ]) {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
    }
  });
  tx();
}
