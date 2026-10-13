import { db } from '../db/pool.js';
import { permissionsRepo } from '../db/repositories/permissions.repo.js';
import { usersRepo } from '../db/repositories/users.repo.js';
import { ensureRoutineReminders, routineNotifies, setRoutinePaused, updateRoutineWithReminders } from './routine-setup.js';
import type { Todo } from '../types/index.js';

/**
 * One-time repairs to routines' data, each run once per database (remembered in app_meta) at boot.
 * They exist because production data can only be changed by the app itself.
 */

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * Every routine that has an hour but no live notice gets its notice + check-in back. Several were
 * left like that in July 2026 (their rows cancelled by tools that didn't protect routine rows yet):
 * listed as routines everywhere, and silent.
 */
function reactivateSilentRoutines(): number {
  const routines = db.prepare(`SELECT * FROM todos WHERE scope = 'routine' AND status = 'pending' AND reminder_time IS NOT NULL`).all() as Todo[];
  let repaired = 0;
  for (const r of routines) {
    if (routineNotifies(r.id)) continue;
    if (!ensureRoutineReminders(r.user_id, r.id)) continue;
    setRoutinePaused(r.user_id, r.id, null); // a pause left on the dead rows would keep it silent
    repaired++;
  }
  return repaired;
}

/**
 * The admin's morning block (shower, morning stretches, sunscreen) belongs at 6:00 am: it had
 * drifted to midday through "reprogramar", which used to change a routine's hour for good. Moved
 * back as a block - the first one at 6:00 and the others keeping their distance from it - and only
 * if it's actually displaced.
 */
const MORNING_BLOCK = [/ducha/i, /estiramientos\s+(de\s+la\s+)?ma[ñn]ana/i, /protecci[oó]n\s+solar/i];
const MORNING_START = 6 * 60;

function restoreMorningBlock(): number {
  const admin = usersRepo.getAdmin();
  if (!admin) return 0;
  const block = (db.prepare(`SELECT * FROM todos WHERE user_id = ? AND scope = 'routine' AND status = 'pending' AND reminder_time IS NOT NULL`).all(admin.id) as Todo[]).filter((r) =>
    MORNING_BLOCK.some((re) => re.test(r.title)),
  );
  if (block.length === 0) return 0;
  const first = Math.min(...block.map((r) => toMinutes(r.reminder_time!)));
  if (first < 9 * 60) return 0;
  for (const r of block) {
    updateRoutineWithReminders(admin.id, r.id, { reminderTime: toTime(MORNING_START + toMinutes(r.reminder_time!) - first) });
  }
  return block.length;
}

const REPAIRS: [key: string, run: () => number, done: string][] = [
  ['repair_routines_reactivated_2026_10', reactivateSilentRoutines, 'rutina(s) sin avisos reactivadas'],
  ['repair_morning_block_6am_2026_10', restoreMorningBlock, 'rutina(s) de la mañana devueltas a las 6:00'],
];

export function repairRoutines(): void {
  for (const [key, run, done] of REPAIRS) {
    if (permissionsRepo.getMeta(key)) continue;
    try {
      const count = run();
      permissionsRepo.setMeta(key, new Date().toISOString());
      if (count) console.log('[RUTINAS] %d %s.', count, done);
    } catch (err) {
      console.error('[RUTINAS] Reparación %s falló:', key, (err as Error).message);
    }
  }
}
