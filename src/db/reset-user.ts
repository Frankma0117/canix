import { db } from './pool.js';

/**
 * Wipes everything a user owns - categories, links, notes, contacts, reminders, todos (cascades
 * their habit_logs automatically), rewards/punishments, chat history - but keeps the user record itself
 * (their access, name, role, jid/lid), so this is a "start over" reset, not a revoke. Used by the
 * /reset todo confirmar chat command (see bot-manager.ts) - deliberately NOT exposed as an agent
 * tool, since something this destructive should never depend on the LLM deciding to call it.
 * Deliberately does NOT touch garments/outfits/fashion_sessions/fashion_profiles - see
 * resetFashionData below, kept as its own separate, separately-confirmed action (a much narrower
 * blast radius than a full account reset).
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
      'notes',
      'links',
      'contacts',
      'categories',
    ]) {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
    }
  });
  tx();
}

export interface FashionResetSummary {
  garmentsDeleted: number;
  outfitsDeleted: number;
  /** Every Spaces object key that belonged to what was just deleted (each garment's original +
   *  thumbnail, plus the profile's reference photo if any) - the caller does the actual Spaces
   *  cleanup (see bot-manager.ts's /reset outfit confirmar), this function only touches the DB. */
  storageKeys: string[];
}

/**
 * Wipes ONLY this user's Fashion Mode data - garments, saved outfits (and their outfit_garments
 * join rows, via ON DELETE CASCADE), the conversational session state, and the styling profile
 * (talla/colores/foto de referencia). Everything else the user owns (reminders, tasks, links, etc.)
 * is untouched - a much narrower reset than resetAllUserData above. Also deliberately not an agent
 * tool, same reasoning as resetAllUserData: this is only ever triggered by the explicit /reset
 * outfit confirmar chat command (see bot-manager.ts), never something the LLM decides to call.
 */
export function resetFashionData(userId: number): FashionResetSummary {
  const garments = db
    .prepare('SELECT storage_key, thumbnail_key FROM garments WHERE user_id = ?')
    .all(userId) as { storage_key: string; thumbnail_key: string | null }[];
  const profile = db
    .prepare('SELECT reference_photo_key FROM fashion_profiles WHERE user_id = ?')
    .get(userId) as { reference_photo_key: string | null } | undefined;

  const storageKeys: string[] = [];
  for (const g of garments) {
    storageKeys.push(g.storage_key);
    if (g.thumbnail_key) storageKeys.push(g.thumbnail_key);
  }
  if (profile?.reference_photo_key) storageKeys.push(profile.reference_photo_key);

  let outfitsDeleted = 0;
  const tx = db.transaction(() => {
    outfitsDeleted = db.prepare('DELETE FROM outfits WHERE user_id = ?').run(userId).changes;
    db.prepare('DELETE FROM garments WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM fashion_sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM fashion_profiles WHERE user_id = ?').run(userId);
  });
  tx();

  return { garmentsDeleted: garments.length, outfitsDeleted, storageKeys };
}
