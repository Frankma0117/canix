import { db } from '../../database/connection.js';
import { permissionsModel } from '../../models/permissions.model.js';
import { guessWorkoutKind } from './workouts.service.js';

const FLAG = 'workouts_from_routines_v1';

/**
 * Before Ejercicios existed, boxeo, zumba, gym... were plain routines. Runs once: every routine
 * whose title is about exercise gets its kind and so moves to Ejercicios - same row, same notices,
 * streak and history, nothing is recreated.
 */
export function migrateExerciseRoutinesToWorkouts(): void {
  if (permissionsModel.getMeta(FLAG)) return;
  const rows = db.prepare("SELECT id, title FROM todos WHERE scope = 'routine' AND workout_kind IS NULL").all() as { id: number; title: string }[];
  let moved = 0;
  db.transaction(() => {
    for (const r of rows) {
      const kind = guessWorkoutKind(r.title);
      if (!kind) continue;
      db.prepare('UPDATE todos SET workout_kind = ? WHERE id = ?').run(kind, r.id);
      moved++;
    }
    permissionsModel.setMeta(FLAG, new Date().toISOString());
  })();
  if (moved) console.log('[WORKOUTS] %d routine(s) about exercise moved to Ejercicios.', moved);
}
