import { routineScheduleFromBody } from './routines.routes.js';
import { type Express, type NextFunction, type Request, type Response } from 'express';
import { todosModel } from '../../models/todos.model.js';
import { usersModel } from '../../models/users.model.js';
import { createRoutineWithReminders, updateRoutineWithReminders, isValidTime } from '../../services/routines/routine-setup.service.js';
import { todayLocal } from '../../shared/utils/datetime.js';
import { h, ownCategoryId, userId } from '../http-helpers.js';
import type { RecurrenceFreq, TodoScope, TodoStatus } from '../../entities/index.js';

/**
 * /api/todos serves both one-off tasks (todos.manage) and routines (routines.manage) - the scope
 * comes from the query/body, or from the existing row for /:id routes. A routine that belongs to
 * Ejercicios (workout_kind) also opens with workouts.manage - its check-in, history and delete are
 * the routine ones.
 */
function todoPermissionGate(req: Request, res: Response, next: NextFunction): void {
  const perms = req.panelPermissions!;
  if (req.panelUser?.role === 'admin') return next();
  let scope = String(req.query.scope ?? req.body?.scope ?? '');
  const idMatch = /^\/(\d+)/.exec(req.path);
  const row = idMatch ? todosModel.getById(req.panelUser!.id, Number(idMatch[1])) : undefined;
  if (!scope && row) scope = row.scope;
  const needed = scope === 'routine' ? 'routines.manage' : scope ? 'todos.manage' : null;
  const ok = (needed ? perms.has(needed) : perms.has('todos.manage') || perms.has('routines.manage')) || (!!row?.workout_kind && perms.has('workouts.manage'));
  if (ok) return next();
  res.status(403).json({ error: 'No tienes habilitado este módulo. Pídeselo al administrador.' });
}

/** To-dos (today / later) and the routine rows they share a table with. */
export function registerTodoRoutes(app: Express): void {
  // One-off tasks need todos.manage, routine rows routines.manage (see todoPermissionGate).
  app.use('/api/todos', todoPermissionGate);

  app.get(
    '/api/todos',
    h((req, res) => {
      const scope = req.query.scope as TodoScope | undefined;
      const status = req.query.status as TodoStatus | undefined;
      const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
      res.json(todosModel.list(userId(req), { scope, status, categoryId }));
    }),
  );
  app.post(
    '/api/todos',
    h((req, res) => {
      const { title, category_id, scope, due_date, recurrence_freq, reminder_time, duration_minutes } = req.body ?? {};
      if (!title) return res.status(400).json({ error: 'title requerido' });

      const uid = userId(req);

      if (scope === 'routine') {
        if (!reminder_time || !isValidTime(String(reminder_time)) || !(Number(duration_minutes) > 0)) {
          return res.status(400).json({ error: 'Las rutinas necesitan una hora de aviso válida y una duración mayor a 0.' });
        }
        const schedule = routineScheduleFromBody(req.body);
        if ('error' in schedule) return res.status(400).json({ error: schedule.error });
        if (schedule.freq === 'weekly' && !schedule.weekdays?.length) {
          return res.status(400).json({ error: 'Elige al menos un día de la semana.' });
        }
        const owner = usersModel.getById(uid)!;
        const id = createRoutineWithReminders(uid, owner.jid, {
          title,
          categoryId: ownCategoryId(req, category_id) ?? null,
          reminderTime: String(reminder_time),
          durationMinutes: Number(duration_minutes),
          ...schedule,
        });
        return res.json({ id });
      }

      const id = todosModel.create(uid, {
        title,
        categoryId: ownCategoryId(req, category_id) ?? null,
        scope: scope || 'today',
        dueDate: due_date || (scope === 'today' ? todayLocal() : null),
        recurrenceFreq: (recurrence_freq as RecurrenceFreq) ?? null,
      });
      res.json({ id });
    }),
  );
  app.put(
    '/api/todos/:id',
    h((req, res) => {
      const uid = userId(req);
      const id = Number(req.params.id);
      const todo = todosModel.getById(uid, id);
      if (!todo) return res.status(404).json({ error: 'No existe esa tarea' });

      const { title, category_id, due_date, reminder_time, duration_minutes } = req.body ?? {};

      if (todo.scope === 'routine') {
        if (reminder_time && !isValidTime(String(reminder_time))) return res.status(400).json({ error: 'La hora de aviso no es válida.' });
        if (duration_minutes !== undefined && !(Number(duration_minutes) > 0)) {
          return res.status(400).json({ error: 'La duración debe ser mayor a 0.' });
        }
        const schedule = routineScheduleFromBody(req.body);
        if ('error' in schedule) return res.status(400).json({ error: schedule.error });
        if (schedule.freq === 'weekly' && schedule.weekdays && schedule.weekdays.length === 0) {
          return res.status(400).json({ error: 'Elige al menos un día de la semana.' });
        }
        const ok = updateRoutineWithReminders(uid, id, {
          title: title || undefined,
          categoryId: ownCategoryId(req, category_id),
          reminderTime: reminder_time || undefined,
          durationMinutes: duration_minutes === undefined ? undefined : Number(duration_minutes),
          ...schedule,
        });
        if (!ok) return res.status(404).json({ error: 'No existe esa rutina' });
        return res.json({ ok: true });
      }

      todosModel.update(uid, id, {
        title: title || undefined,
        categoryId: ownCategoryId(req, category_id),
        dueDate: due_date === undefined ? undefined : due_date,
      });
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/todos/:id/complete',
    h((req, res) => {
      todosModel.complete(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/todos/:id',
    h((req, res) => {
      todosModel.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );
}
