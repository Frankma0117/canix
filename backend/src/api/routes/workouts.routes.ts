import type { Express, Request } from 'express';
import { todosModel } from '../../models/todos.model.js';
import { usersModel } from '../../models/users.model.js';
import { exercisesModel } from '../../models/exercises.model.js';
import { createRoutineWithReminders, updateRoutineWithReminders, isValidTime } from '../../services/routines/routine-setup.service.js';
import { WORKOUT_KINDS, isWorkoutKind, listWorkouts, minutesText, weekSummary, workoutWeek } from '../../services/workouts/workouts.service.js';
import { todayLocal, nowLocal } from '../../shared/utils/datetime.js';
import { requirePermission } from '../middleware/auth.middleware.js';
import { h, ownCategoryId, userId, str } from '../http-helpers.js';
import { routineScheduleFromBody, routineView } from './routines.routes.js';
import type { Todo } from '../../entities/index.js';

/** Optional text: undefined = not sent, null = cleared. */
function text(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  return str(value, max) || null;
}

/** A positive number, null when cleared, undefined when not sent. */
function amount(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return value === null || value === '' || !Number.isFinite(n) || n <= 0 ? null : n;
}

/** A workout as the portal shows it: the routine view plus kind, place, notes, the week and its exercises. */
function view(t: Todo, today: string, now: string) {
  return {
    ...routineView(t, today, now),
    place: t.place,
    notes: t.notes,
    week: workoutWeek(t, today),
    exercises: exercisesModel.listByRoutine(t.user_id, t.id),
  };
}

function exerciseFields(req: Request) {
  const b = req.body ?? {};
  return { name: str(b.name, 120) || undefined, sets: amount(b.sets), reps: amount(b.reps), seconds: amount(b.seconds), weightKg: amount(b.weight_kg) };
}

/** Ejercicios (see services/workouts/): routines with a kind; check-in, history and delete go through /api/todos. */
export function registerWorkoutRoutes(app: Express): void {
  app.use('/api/workouts', requirePermission('workouts.manage'));

  app.get(
    '/api/workouts',
    h((req, res) => {
      const uid = userId(req);
      const today = todayLocal();
      const now = nowLocal();
      const summary = weekSummary(uid, today);
      res.json({ kinds: WORKOUT_KINDS, summary: { ...summary, minutes_text: minutesText(summary.minutes) }, items: listWorkouts(uid).map((t) => view(t, today, now)) });
    }),
  );

  app.post(
    '/api/workouts',
    h((req, res) => {
      const b = req.body ?? {};
      const title = str(b.title, 120);
      if (!title) return void res.status(400).json({ error: 'Falta el nombre (ej. Boxeo, Zumba).' });
      if (!b.reminder_time || !isValidTime(String(b.reminder_time)) || !(Number(b.duration_minutes) > 0)) {
        return void res.status(400).json({ error: 'Necesito una hora de aviso válida y una duración mayor a 0.' });
      }
      const schedule = routineScheduleFromBody(b);
      if ('error' in schedule) return void res.status(400).json({ error: schedule.error });
      if (schedule.freq === 'weekly' && !schedule.weekdays?.length) return void res.status(400).json({ error: 'Elige al menos un día de la semana.' });
      const uid = userId(req);
      const id = createRoutineWithReminders(uid, usersModel.getById(uid)!.jid, {
        title,
        categoryId: ownCategoryId(req, b.category_id) ?? null,
        reminderTime: String(b.reminder_time),
        durationMinutes: Number(b.duration_minutes),
        workoutKind: isWorkoutKind(b.workout_kind) ? b.workout_kind : 'other',
        place: text(b.place, 120) ?? null,
        notes: text(b.notes, 1000) ?? null,
        ...schedule,
      });
      res.status(201).json(view(todosModel.getById(uid, id)!, todayLocal(), nowLocal()));
    }),
  );

  app.put(
    '/api/workouts/:id',
    h((req, res) => {
      const uid = userId(req);
      const id = Number(req.params.id);
      const current = todosModel.getById(uid, id);
      if (!current?.workout_kind) return void res.status(404).json({ error: 'No existe ese ejercicio.' });
      const b = req.body ?? {};
      if (b.reminder_time && !isValidTime(String(b.reminder_time))) return void res.status(400).json({ error: 'La hora de aviso no es válida.' });
      if (b.duration_minutes !== undefined && !(Number(b.duration_minutes) > 0)) return void res.status(400).json({ error: 'La duración debe ser mayor a 0.' });
      const schedule = routineScheduleFromBody(b);
      if ('error' in schedule) return void res.status(400).json({ error: schedule.error });
      if (schedule.freq === 'weekly' && schedule.weekdays && schedule.weekdays.length === 0) return void res.status(400).json({ error: 'Elige al menos un día de la semana.' });
      updateRoutineWithReminders(uid, id, {
        title: str(b.title, 120) || undefined,
        categoryId: ownCategoryId(req, b.category_id),
        reminderTime: b.reminder_time || undefined,
        durationMinutes: b.duration_minutes === undefined ? undefined : Number(b.duration_minutes),
        ...schedule,
      });
      todosModel.setWorkout(uid, id, { kind: isWorkoutKind(b.workout_kind) ? b.workout_kind : undefined, place: text(b.place, 120), notes: text(b.notes, 1000) });
      res.json(view(todosModel.getById(uid, id)!, todayLocal(), nowLocal()));
    }),
  );

  // The exercises of a workout (rounds, sets, reps, seconds, weight) - shown in its notice too.
  app.post(
    '/api/workouts/:id/exercises',
    h((req, res) => {
      const uid = userId(req);
      const workout = todosModel.getById(uid, Number(req.params.id));
      if (!workout?.workout_kind) return void res.status(404).json({ error: 'No existe ese ejercicio.' });
      const f = exerciseFields(req);
      if (!f.name) return void res.status(400).json({ error: 'Falta el nombre del ejercicio.' });
      const id = exercisesModel.create(uid, { todoId: workout.id, name: f.name, sets: f.sets ?? null, reps: f.reps ?? null, seconds: f.seconds ?? null, weightKg: f.weightKg ?? null });
      res.status(201).json(exercisesModel.getById(uid, id));
    }),
  );

  app.patch(
    '/api/workouts/:id/exercises/:exerciseId',
    h((req, res) => {
      const uid = userId(req);
      const exercise = exercisesModel.getById(uid, Number(req.params.exerciseId));
      if (!exercise || exercise.todo_id !== Number(req.params.id)) return void res.status(404).json({ error: 'No existe ese ejercicio.' });
      exercisesModel.update(uid, exercise.id, exerciseFields(req));
      res.json(exercisesModel.getById(uid, exercise.id));
    }),
  );

  app.delete(
    '/api/workouts/:id/exercises/:exerciseId',
    h((req, res) => {
      const uid = userId(req);
      const exercise = exercisesModel.getById(uid, Number(req.params.exerciseId));
      if (exercise && exercise.todo_id === Number(req.params.id)) exercisesModel.remove(uid, exercise.id);
      res.json({ ok: true });
    }),
  );
}
