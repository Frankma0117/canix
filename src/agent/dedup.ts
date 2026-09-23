import { db } from '../db/pool.js';
import { todosRepo } from '../db/repositories/todos.repo.js';
import { remindersRepo } from '../db/repositories/reminders.repo.js';
import { garmentsRepo } from '../db/repositories/garments.repo.js';
import { usersRepo } from '../db/repositories/users.repo.js';
import { linksRepo } from '../db/repositories/links.repo.js';
import { notesRepo } from '../db/repositories/notes.repo.js';
import { exercisesRepo } from '../db/repositories/exercises.repo.js';
import { mealPlansRepo } from '../db/repositories/meal-plans.repo.js';
import { recipesRepo } from '../db/repositories/recipes.repo.js';
import { outfitsRepo, type OutfitWithGarments } from '../db/repositories/outfits.repo.js';
import { callRemindersRepo } from '../db/repositories/call-reminders.repo.js';
import { spacesStorageService } from '../fashion/storage/spaces-storage.service.js';
import { todayLocal, nowLocal, addDays } from '../util/datetime.js';
import { stripKnownPrefix } from '../util/motivational.js';
import { env } from '../config/env.js';
import type { Reminder, ReminderKind, Todo, Garment, Link, Note, Exercise, MealPlan, Recipe, CallReminder } from '../types/index.js';

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Matches a trailing time-of-day tag some reminders get worded with (e.g. "Hora de tomar tu
// apixaban (mañana)" vs "Hora de tomar tu apixaban") - two reminders that only differ by this tag
// are the exact "same thing, said slightly differently" duplicate reported in practice (a
// medication reminder created once as "...", once as "... (mañana)"), so it's stripped before
// comparing, same idea as stripKnownPrefix() below for the random emoji lead-in.
const TIME_OF_DAY_SUFFIX_RE = /\s*\((madrugada|ma[nñ]ana|tarde|noche)\)\s*$/i;

/** Normalizes a reminder's message for duplicate comparison ONLY (not for display) - strips the
 *  random emoji prefix some kinds bake in at creation (stripKnownPrefix) and a trailing "(mañana)"/
 *  "(tarde)"/"(noche)"/"(madrugada)" tag, then case/whitespace-folds what's left. Deliberately a
 *  separate function from normalize() above (used for routine titles too) - collapsing that same
 *  suffix there could wrongly merge two routines the user made distinct ON PURPOSE, like "Yoga
 *  (mañana)" and "Yoga (noche)" as two different daily habits; a reminder has no such legitimate
 *  "same title, different time-of-day tag, both intentional" case since the tag itself is only ever
 *  decorative wording, never data. */
function normalizeReminderMessage(message: string): string {
  return normalize(stripKnownPrefix(message).replace(TIME_OF_DAY_SUFFIX_RE, ''));
}

/**
 * Duplicate-detection key for a reminder-like set of fields - two reminders are duplicates iff they
 * share kind + target_jid + recurrence_freq/interval + the same normalized message + the same
 * time-of-day (+ same calendar date for a true one-off, since two distinct one-off reminders on
 * different days aren't duplicates just for sharing a clock time) + the same window for `flexible`.
 * Exported so both the nightly sweep (dedupeReminders below) and schedule_reminder's own
 * create-time check (see schedule-reminder.tool.ts) use the exact same definition of "duplicate" -
 * catching it at creation is strictly better (the user never even sees the double-fire), the nightly
 * sweep stays as the safety net for whatever slips through (a race, a kind this check doesn't cover).
 */
export function reminderDedupeKey(r: {
  kind: ReminderKind;
  target_jid: string | null;
  recurrence_freq: string;
  recurrence_interval: number;
  message: string;
  run_at: string;
  window_start?: string | null;
  window_end?: string | null;
}): string {
  return [
    r.kind,
    r.target_jid ?? '',
    r.recurrence_freq,
    r.recurrence_interval,
    normalizeReminderMessage(r.message),
    r.run_at.slice(11, 16),
    r.recurrence_freq === 'none' ? r.run_at.slice(0, 10) : '',
    r.kind === 'flexible' ? `${r.window_start ?? ''}-${r.window_end ?? ''}` : '',
  ].join('|');
}

/**
 * Creates the recurring "daily_dedup" reminder for a user if they don't already have one - same
 * idempotent-bootstrap pattern as ensureWeeklyReportReminder (see agent/weekly-report.ts), called
 * from the same registration points. Fires daily at DAILY_DEDUP_TIME; task-scheduler.ts handles this
 * kind by silently running dedupeUser() below - no WhatsApp message is ever sent, this is purely
 * internal housekeeping ("no es necesario repetir las cosas").
 */
export function ensureDailyDedupReminder(userId: number, targetJid: string): void {
  const already = remindersRepo.listAll(userId).some((r) => r.kind === 'daily_dedup');
  if (already) return;

  const [h, m] = env.dailyDedupTime.split(':').map(Number);
  const hh = String(h ?? 4).padStart(2, '0');
  const mm = String(m ?? 10).padStart(2, '0');
  let runAt = `${todayLocal()} ${hh}:${mm}:00`;
  if (runAt <= nowLocal()) runAt = `${addDays(todayLocal(), 1).slice(0, 10)} ${hh}:${mm}:00`;

  remindersRepo.create(userId, {
    message: 'Limpieza diaria de duplicados', // unused at send time - never actually sent
    runAt,
    targetJid,
    categoryId: null,
    recurrenceFreq: 'daily',
    recurrenceInterval: 1,
    kind: 'daily_dedup',
  });
  console.log('[DEDUP] Limpieza diaria de duplicados programada para el usuario #%d a las %s:%s.', userId, hh, mm);
}

/**
 * Every resource this sweep covers. Deliberately does NOT include: categories/contacts (structurally
 * can't duplicate - both have a DB-level UNIQUE(user_id, ...) constraint, see db/init.ts), habit_logs
 * (UNIQUE(todo_id, log_date), same reason), messages/ai_usage (operational logs, not a "saved thing"
 * a user could have accidentally double-added), rewards_punishments (a dated event log - two
 * same-day entries could be genuinely intentional, not a mistake), fashion_sessions/fashion_profiles/
 * stickers/pending_shared_contacts (singleton-per-user or transient state, nothing to dedupe).
 */
export interface DedupSummary {
  routinesMerged: number;
  remindersRemoved: number;
  garmentsMerged: number;
  linksRemoved: number;
  notesRemoved: number;
  todosRemoved: number;
  exercisesRemoved: number;
  mealPlansRemoved: number;
  recipesRemoved: number;
  outfitsRemoved: number;
  callRemindersRemoved: number;
}

const DEDUP_LABELS: Record<keyof DedupSummary, string> = {
  routinesMerged: 'rutina(s) fusionada(s)',
  remindersRemoved: 'recordatorio(s) duplicado(s)',
  garmentsMerged: 'prenda(s) duplicada(s)',
  linksRemoved: 'link(s) duplicado(s)',
  notesRemoved: 'nota(s) duplicada(s)',
  todosRemoved: 'tarea(s) duplicada(s)',
  exercisesRemoved: 'ejercicio(s) duplicado(s)',
  mealPlansRemoved: 'plan(es) de comida duplicado(s)',
  recipesRemoved: 'receta(s) duplicada(s)',
  outfitsRemoved: 'outfit(s) duplicado(s)',
  callRemindersRemoved: 'recordatorio(s) de llamada duplicado(s)',
};

function emptySummary(): DedupSummary {
  return {
    routinesMerged: 0,
    remindersRemoved: 0,
    garmentsMerged: 0,
    linksRemoved: 0,
    notesRemoved: 0,
    todosRemoved: 0,
    exercisesRemoved: 0,
    mealPlansRemoved: 0,
    recipesRemoved: 0,
    outfitsRemoved: 0,
    callRemindersRemoved: 0,
  };
}

/** Total across every category - 0 means genuinely nothing to report, the common case on any given
 *  run once a wardrobe/account has already been swept before. */
export function summaryTotal(s: DedupSummary): number {
  return Object.values(s).reduce((sum, n) => sum + n, 0);
}

/** Human-readable summary listing only the categories that actually had something to clean - a
 *  quiet run (the common case) produces an empty string, never a wall of "0 de esto, 0 de aquello". */
export function summaryLine(s: DedupSummary): string {
  return (Object.keys(DEDUP_LABELS) as (keyof DedupSummary)[])
    .filter((k) => s[k] > 0)
    .map((k) => `${s[k]} ${DEDUP_LABELS[k]}`)
    .join(', ');
}

/**
 * Scans ABSOLUTELY EVERYTHING a user can accumulate duplicates of - routines, reminders, garments,
 * links, notes, tasks, exercises, meal plans, recipes, saved outfits, and call reminders - and keeps
 * only one of each. Run once a day per user (see ensureDailyDedupReminder above / task-scheduler.ts)
 * AND once for EVERY user on every boot (see dedupeAllUsers below / index.ts), so a redeploy always
 * leaves everyone's data clean instead of only whoever's own daily timer happens to have fired since
 * the last update. The DB side is wrapped in a single transaction (same idiom as db/reset-user.ts) so
 * a mid-pass crash can't leave a half-merged state; the Spaces photo cleanup for merged-away garments
 * happens AFTER that transaction commits (better-sqlite3 transactions must be synchronous, so the
 * async cleanup can't live inside it) - best-effort, same as every other Spaces delete in this app.
 */
export async function dedupeUser(userId: number): Promise<DedupSummary> {
  const summary = emptySummary();
  let garmentStorageKeys: string[] = [];
  const tx = db.transaction(() => {
    summary.routinesMerged = dedupeRoutines(userId);
    summary.remindersRemoved = dedupeReminders(userId);
    ({ merged: summary.garmentsMerged, storageKeys: garmentStorageKeys } = dedupeGarments(userId));
    summary.linksRemoved = dedupeLinks(userId);
    summary.notesRemoved = dedupeNotes(userId);
    summary.todosRemoved = dedupeTodos(userId);
    summary.exercisesRemoved = dedupeExercises(userId);
    summary.mealPlansRemoved = dedupeMealPlans(userId);
    summary.recipesRemoved = dedupeRecipes(userId);
    summary.outfitsRemoved = dedupeOutfits(userId);
    summary.callRemindersRemoved = dedupeCallReminders(userId);
  });
  tx();
  if (garmentStorageKeys.length) await spacesStorageService.delete(garmentStorageKeys);
  return summary;
}

/** Runs dedupeUser for every registered user - called once at boot (see index.ts), so every
 *  redeploy/restart cleans everyone's data instead of waiting on each person's own daily timer.
 *  Sequential, not parallel: this only ever runs once per process start, and keeping peak load
 *  predictable on the small server matters more here than shaving a few seconds off boot. */
export async function dedupeAllUsers(): Promise<void> {
  const total = emptySummary();
  for (const user of usersRepo.listAll()) {
    const summary = await dedupeUser(user.id);
    for (const key of Object.keys(total) as (keyof DedupSummary)[]) total[key] += summary[key];
  }
  if (summaryTotal(total) > 0) {
    console.log('[DEDUP] Limpieza al arrancar (todos los usuarios): %s.', summaryLine(total));
  }
}

/**
 * Two routines are duplicates iff they match on title (normalized) + recurrence_freq +
 * reminder_time + duration_minutes ALL together - matching on title alone risks merging two
 * routines that just happen to share a name but have a meaningfully different schedule. Keeps the
 * one with the most habit_logs history (richest tracked streak, not just "oldest") so a duplicate
 * created later doesn't wipe out a well-tracked routine just for being younger; the losing
 * duplicate's own history is merged into the survivor first (INSERT OR IGNORE respects the
 * existing UNIQUE(todo_id, log_date), so a genuine same-day conflict just keeps the survivor's
 * entry) before todosRepo.remove() cascades it away.
 */
function dedupeRoutines(userId: number): number {
  const routines = todosRepo.list(userId, { scope: 'routine' });
  const groups = new Map<string, Todo[]>();
  for (const r of routines) {
    const key = [normalize(r.title), r.recurrence_freq, r.reminder_time, r.duration_minutes].join('|');
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }

  let merged = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const withCounts = group.map((todo) => ({
      todo,
      count: (db.prepare('SELECT COUNT(*) AS c FROM habit_logs WHERE todo_id = ?').get(todo.id) as { c: number }).c,
    }));
    withCounts.sort((a, b) => b.count - a.count || a.todo.id - b.todo.id);
    const survivor = withCounts[0].todo;
    for (const { todo: loser } of withCounts.slice(1)) {
      db.prepare(
        `INSERT OR IGNORE INTO habit_logs (todo_id, log_date, done, note)
         SELECT ?, log_date, done, note FROM habit_logs WHERE todo_id = ?`,
      ).run(survivor.id, loser.id);
      todosRepo.remove(userId, loser.id); // cascades: merged habit_logs rows, its own routine_reminder/routine_checkin pair
      merged += 1;
    }
  }
  return merged;
}

// routine_reminder/routine_checkin are handled as a byproduct of dedupeRoutines above;
// daily_agenda/weekly_report/daily_reset/daily_dedup are already structurally single-per-user via
// their own ensureX idempotency guard; interval reminders are short-lived/self-terminating, "same
// content" has no meaningful duplicate concept mid-timer.
const DEDUPABLE_KINDS: ReminderKind[] = ['reminder', 'important_date', 'flexible'];

/**
 * Two reminders are duplicates iff reminderDedupeKey() (above) matches - see that function for the
 * exact fields compared. Keeps the oldest (lowest id) - reminders carry no per-row history worth
 * preserving the way a routine's habit_logs does, so "oldest wins" is safe and simple here.
 */
function dedupeReminders(userId: number): number {
  const reminders = remindersRepo.listAll(userId, 'pending').filter((r) => DEDUPABLE_KINDS.includes(r.kind));
  const groups = new Map<string, Reminder[]>();
  for (const r of reminders) {
    const key = reminderDedupeKey(r);
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }

  let removed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.id - b.id);
    for (const loser of sorted.slice(1)) {
      remindersRepo.remove(userId, loser.id);
      removed += 1;
    }
  }
  return removed;
}

// Every structured attribute CLIP (or a manual edit) can fill in, minus color's own secondary/
// pattern nuance which is already folded in below - deliberately requiring ALL of these to match
// (not just type+category+color) before calling two garments duplicates, since unlike a reminder's
// exact text match, two genuinely different real garments (two different plain white t-shirts) can
// easily share a handful of attributes without being an accidental double-add. Full-field agreement
// is a much higher, safer bar - see the module comment on dedupeUser for why this matters more here
// than for text-based duplicates (a garment represents a real purchased item, not just a message).
const GARMENT_MATCH_FIELDS = [
  'type', 'category', 'color', 'pattern', 'material', 'fit', 'neckline', 'sleeves', 'closure', 'pockets', 'length',
] as const satisfies readonly (keyof Garment)[];

function garmentDedupeKey(g: Garment): string {
  return GARMENT_MATCH_FIELDS.map((f) => g[f] ?? '').join('|');
}

/** Two garments are duplicates iff EVERY field in GARMENT_MATCH_FIELDS matches exactly. Keeps the
 *  one with the richest analysis (most fields actually filled in, favoring a garment that's been
 *  through more/better classification passes over a sparser one), tie-broken by the newest
 *  analysis_version, then oldest id (earliest added) - same "richest data survives" spirit as
 *  dedupeRoutines' habit_logs-count tiebreak above. */
function dedupeGarments(userId: number): { merged: number; storageKeys: string[] } {
  const garments = garmentsRepo.listAllActive(userId);
  const groups = new Map<string, Garment[]>();
  for (const g of garments) {
    const arr = groups.get(garmentDedupeKey(g)) ?? [];
    arr.push(g);
    groups.set(garmentDedupeKey(g), arr);
  }

  let merged = 0;
  const storageKeys: string[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const richness = (g: Garment) => GARMENT_MATCH_FIELDS.filter((f) => g[f]).length;
    const sorted = [...group].sort(
      (a, b) => richness(b) - richness(a) || (b.analysis_version ?? 0) - (a.analysis_version ?? 0) || a.id - b.id,
    );
    for (const loser of sorted.slice(1)) {
      const removed = garmentsRepo.remove(userId, loser.id);
      if (removed) {
        storageKeys.push(removed.storageKey);
        if (removed.thumbnailKey) storageKeys.push(removed.thumbnailKey);
      }
      merged += 1;
    }
  }
  return { merged, storageKeys };
}

/** Two links are duplicates iff the same URL (trailing-slash/case-insensitive) was saved twice -
 *  keeps the one that's actually been used (list_links'/pick_link's used_count), then the one with
 *  a title, then oldest. Never scoped to category: the same URL saved under two different
 *  categories is still the same link, not two different ones. */
function dedupeLinks(userId: number): number {
  const links = linksRepo.listByCategory(userId);
  const groups = new Map<string, Link[]>();
  for (const l of links) {
    const key = normalize(l.url).replace(/\/+$/, '');
    const arr = groups.get(key) ?? [];
    arr.push(l);
    groups.set(key, arr);
  }
  let removed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => b.used_count - a.used_count || Number(!!b.title) - Number(!!a.title) || a.id - b.id);
    for (const loser of sorted.slice(1)) {
      linksRepo.remove(userId, loser.id);
      removed += 1;
    }
  }
  return removed;
}

/** Two notes are duplicates iff the same category AND the exact same (normalized) content were
 *  saved twice - content is the actual point of a note, so this is a much safer bar than matching
 *  on title alone (many notes have no title at all). Keeps the one with a title if only one has it. */
function dedupeNotes(userId: number): number {
  const notes = notesRepo.listByCategory(userId);
  const groups = new Map<string, Note[]>();
  for (const n of notes) {
    const key = `${n.category_id ?? ''}|${normalize(n.content)}`;
    const arr = groups.get(key) ?? [];
    arr.push(n);
    groups.set(key, arr);
  }
  let removed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => Number(!!b.title) - Number(!!a.title) || a.id - b.id);
    for (const loser of sorted.slice(1)) {
      notesRepo.remove(userId, loser.id);
      removed += 1;
    }
  }
  return removed;
}

/** Two tasks are duplicates iff same scope + normalized title + due date + category, AND both are
 *  still 'pending' - a completed task alongside an identically-worded pending one is deliberately
 *  NOT touched (could be a legitimately recreated task, not a leftover double-add). 'routine' scope
 *  is handled separately by dedupeRoutines above, not here. */
function dedupeTodos(userId: number): number {
  const todos = [...todosRepo.list(userId, { scope: 'today', status: 'pending' }), ...todosRepo.list(userId, { scope: 'later', status: 'pending' })];
  const groups = new Map<string, Todo[]>();
  for (const t of todos) {
    const key = [t.scope, normalize(t.title), t.due_date ?? '', t.category_id ?? ''].join('|');
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }
  let removed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.id - b.id);
    for (const loser of sorted.slice(1)) {
      todosRepo.remove(userId, loser.id);
      removed += 1;
    }
  }
  return removed;
}

/** Two exercises are duplicates iff they belong to the SAME routine and match on name + sets + reps
 *  + seconds + weight - scoped per-routine (never across two different routines, which could
 *  legitimately share an exercise like "sentadillas") and requiring every number to match too, not
 *  just the name, since the same exercise at a different weight/reps is progress, not a duplicate. */
function dedupeExercises(userId: number): number {
  const routines = todosRepo.list(userId, { scope: 'routine' });
  let removed = 0;
  for (const routine of routines) {
    const exercises = exercisesRepo.listByRoutine(userId, routine.id);
    const groups = new Map<string, Exercise[]>();
    for (const e of exercises) {
      const key = [normalize(e.name), e.sets ?? '', e.reps ?? '', e.seconds ?? '', e.weight_kg ?? ''].join('|');
      const arr = groups.get(key) ?? [];
      arr.push(e);
      groups.set(key, arr);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => a.order_index - b.order_index || a.id - b.id);
      for (const loser of sorted.slice(1)) {
        exercisesRepo.remove(userId, loser.id);
        removed += 1;
      }
    }
  }
  return removed;
}

/** Two meal plans are duplicates iff the same date + meal slot + normalized title were planned
 *  twice - deliberately requires the title to match too (not just date+slot), since re-planning a
 *  meal for the same slot with a DIFFERENT dish is a real edit, not a duplicate (edit_meal_plan
 *  exists for that; this only catches an accidental identical re-add). */
function dedupeMealPlans(userId: number): number {
  const plans = mealPlansRepo.listRange(userId, '0000-01-01', '9999-12-31');
  const groups = new Map<string, MealPlan[]>();
  for (const p of plans) {
    const key = [p.plan_date, p.meal_slot, normalize(p.title)].join('|');
    const arr = groups.get(key) ?? [];
    arr.push(p);
    groups.set(key, arr);
  }
  let removed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.id - b.id);
    for (const loser of sorted.slice(1)) {
      mealPlansRepo.remove(userId, loser.id);
      removed += 1;
    }
  }
  return removed;
}

/** Two recipes are duplicates iff the same normalized title AND ingredients were saved twice - both,
 *  not just the title, since two different real recipes can share a generic name ("ensalada"). */
function dedupeRecipes(userId: number): number {
  const recipes = recipesRepo.listAll(userId);
  const groups = new Map<string, Recipe[]>();
  for (const r of recipes) {
    const key = `${normalize(r.title)}|${normalize(r.ingredients)}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  let removed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.id - b.id);
    for (const loser of sorted.slice(1)) {
      recipesRepo.remove(userId, loser.id);
      removed += 1;
    }
  }
  return removed;
}

/** Two saved outfits are duplicates iff they combine the EXACT same set of garments (order doesn't
 *  matter) - an outfit with zero garments left (every one of them since deleted) is skipped rather
 *  than treated as an empty-key match, which would otherwise merge every emptied-out outfit
 *  together regardless of how different they originally were. Keeps the favorited one if only one
 *  of the group is. */
function dedupeOutfits(userId: number): number {
  const { rows } = outfitsRepo.list(userId, { limit: 100000, offset: 0 });
  const groups = new Map<string, OutfitWithGarments[]>();
  for (const o of rows) {
    const key = o.garments
      .map((g) => g.garment_id)
      .sort((a, b) => a - b)
      .join(',');
    if (!key) continue;
    const arr = groups.get(key) ?? [];
    arr.push(o);
    groups.set(key, arr);
  }
  let removed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => b.favorite - a.favorite || a.id - b.id);
    for (const loser of sorted.slice(1)) {
      outfitsRepo.remove(userId, loser.id);
      removed += 1;
    }
  }
  return removed;
}

// Same kinds a plain reminder dedupes on (see DEDUPABLE_KINDS above), adapted to call_reminders'
// own column names - only 'pending' ones, same reasoning as dedupeReminders (a call already placed/
// failed/cancelled isn't a live duplicate risk anymore).
function dedupeCallReminders(userId: number): number {
  const reminders = callRemindersRepo.listAll(userId, 'pending');
  const groups = new Map<string, CallReminder[]>();
  for (const r of reminders) {
    const key = [
      r.phone_number,
      r.call_type,
      normalize(r.message),
      r.recurrence_freq,
      r.recurrence_interval,
      r.scheduled_at.slice(11, 16),
      r.recurrence_freq === 'none' ? r.scheduled_at.slice(0, 10) : '',
    ].join('|');
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  let removed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.id - b.id);
    for (const loser of sorted.slice(1)) {
      callRemindersRepo.remove(userId, loser.id);
      removed += 1;
    }
  }
  return removed;
}
