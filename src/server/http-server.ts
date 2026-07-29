import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import qrcode from 'qrcode';
import type { BotManager } from '../whatsapp/bot-manager.js';
import { categoriesRepo } from '../db/repositories/categories.repo.js';
import { linksRepo } from '../db/repositories/links.repo.js';
import { contactsRepo } from '../db/repositories/contacts.repo.js';
import { remindersRepo } from '../db/repositories/reminders.repo.js';
import { todosRepo } from '../db/repositories/todos.repo.js';
import { habitLogsRepo } from '../db/repositories/habit-logs.repo.js';
import { rewardsRepo } from '../db/repositories/rewards.repo.js';
import { usersRepo } from '../db/repositories/users.repo.js';
import { createRoutineWithReminders, updateRoutineWithReminders } from '../agent/routine-setup.js';
import { todayLocal } from '../util/datetime.js';
import { phoneToJid } from '../util/jid.js';
import { requireAdminToken, validateLogin } from './auth.js';
import type { RecurrenceFreq, TodoScope, TodoStatus, ReminderStatus, RewardPunishmentType } from '../types/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', '..', 'public');

/**
 * The panel is admin-only (gated by ADMIN_TOKEN) and always operates on the admin's own data -
 * other users only ever interact through WhatsApp chat, never the panel (see grant_access tool).
 * Throws until the admin has bootstrapped (their first message to the bot) - caught by h() below.
 */
function getAdminId(): number {
  const admin = usersRepo.getAdmin();
  if (!admin) {
    throw new Error('Aún no hay administrador registrado: escríbele al bot por WhatsApp primero.');
  }
  return admin.id;
}

/** Wraps a handler (sync or async) and forwards thrown/rejected errors to Express as a 500. */
function h(fn: (req: Request, res: Response) => unknown) {
  return (req: Request, res: Response) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((err) => {
        console.error('[API] Error:', (err as Error).message);
        res.status(500).json({ error: (err as Error).message });
      });
  };
}

export function createServer(bot: BotManager): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(publicDir));

  // ---------- Panel authentication ----------
  app.post(
    '/api/auth/login',
    h((req, res) => {
      const { token } = req.body ?? {};
      if (!validateLogin(String(token ?? ''))) {
        res.status(401).json({ error: 'Token invalido' });
        return;
      }
      res.json({ ok: true });
    }),
  );

  app.use('/api', requireAdminToken);

  // ---------- WhatsApp connection ----------
  app.get(
    '/api/connection/status',
    h((_req, res) => {
      const wa = bot.session;
      res.json({
        connection: wa.connectionState,
        connected: wa.isConnected(),
        hasQr: Boolean(wa.qr),
        banSuspected: wa.banSuspected,
      });
    }),
  );
  app.get(
    '/api/connection/qr/png',
    h(async (_req, res) => {
      const wa = bot.session;
      if (!wa.qr) {
        res.status(404).json({ error: 'No hay QR disponible' });
        return;
      }
      const png = await qrcode.toBuffer(wa.qr, { width: 320, margin: 1 });
      res.setHeader('Content-Type', 'image/png');
      res.send(png);
    }),
  );
  // Manually re-establish the WhatsApp connection without restarting the whole process.
  // No-op if already connected/connecting; intentionally NOT automatic after a 403 (see wa-manager.ts).
  app.post(
    '/api/connection/reconnect',
    h(async (_req, res) => {
      await bot.session.reconnect();
      res.json({ ok: true });
    }),
  );
  // Abandons the currently linked number and shows a new QR to link a different one.
  // Deliberate admin action only - never triggered automatically.
  app.post(
    '/api/connection/new-number',
    h(async (_req, res) => {
      await bot.session.useNewNumber();
      res.json({ ok: true });
    }),
  );

  // ---------- Categories ----------
  app.get('/api/categories', h((_req, res) => res.json(categoriesRepo.listAll(getAdminId()))));
  app.post(
    '/api/categories',
    h((req, res) => {
      const { name, description } = req.body ?? {};
      if (!name) return res.status(400).json({ error: 'name requerido' });
      const id = categoriesRepo.create(getAdminId(), name, description || null);
      res.json({ id });
    }),
  );
  app.put(
    '/api/categories/:id',
    h((req, res) => {
      categoriesRepo.update(getAdminId(), Number(req.params.id), req.body ?? {});
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/categories/:id',
    h((req, res) => {
      categoriesRepo.remove(getAdminId(), Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  // ---------- Links ----------
  app.get(
    '/api/links',
    h((req, res) => {
      const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
      res.json(linksRepo.listByCategory(getAdminId(), categoryId));
    }),
  );
  app.post(
    '/api/links',
    h((req, res) => {
      const { url, category_id, title, description } = req.body ?? {};
      if (!url) return res.status(400).json({ error: 'url requerida' });
      const id = linksRepo.create(getAdminId(), {
        url,
        categoryId: category_id ?? null,
        title: title || null,
        description: description || null,
      });
      res.json({ id });
    }),
  );
  app.delete(
    '/api/links/:id',
    h((req, res) => {
      linksRepo.remove(getAdminId(), Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  // ---------- Contacts ----------
  app.get('/api/contacts', h((_req, res) => res.json(contactsRepo.listAll(getAdminId()))));
  app.post(
    '/api/contacts',
    h((req, res) => {
      const { name, phone, notes } = req.body ?? {};
      if (!name || !phone) return res.status(400).json({ error: 'name y phone requeridos' });
      const contact = contactsRepo.upsert(getAdminId(), name, phoneToJid(phone), notes || null);
      res.json(contact);
    }),
  );
  app.delete(
    '/api/contacts/:id',
    h((req, res) => {
      contactsRepo.remove(getAdminId(), Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  // ---------- Reminders ----------
  app.get(
    '/api/reminders',
    h((req, res) => {
      const status = req.query.status as ReminderStatus | undefined;
      const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
      const adminId = getAdminId();
      res.json(categoryId ? remindersRepo.listByCategory(adminId, categoryId, status) : remindersRepo.listAll(adminId, status));
    }),
  );
  app.put(
    '/api/reminders/:id',
    h((req, res) => {
      const adminId = getAdminId();
      const id = Number(req.params.id);
      const reminder = remindersRepo.getById(adminId, id);
      if (!reminder) return res.status(404).json({ error: 'No existe ese recordatorio' });
      if (reminder.kind === 'routine_reminder' || reminder.kind === 'routine_checkin' || reminder.kind === 'daily_agenda') {
        return res.status(400).json({ error: 'Este recordatorio pertenece a una rutina o es automático - edítalo desde su rutina' });
      }
      const { message, run_at, category_id, recurrence_freq, recurrence_interval } = req.body ?? {};
      remindersRepo.update(adminId, id, {
        message: message || undefined,
        runAt: run_at || undefined,
        categoryId: category_id === undefined ? undefined : category_id,
        recurrenceFreq: recurrence_freq || undefined,
        recurrenceInterval: recurrence_interval === undefined ? undefined : Number(recurrence_interval),
      });
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/reminders/:id/cancel',
    h((req, res) => {
      remindersRepo.cancel(getAdminId(), Number(req.params.id));
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/reminders/:id',
    h((req, res) => {
      remindersRepo.remove(getAdminId(), Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  // ---------- Todos (today / later / routine) ----------
  app.get(
    '/api/todos',
    h((req, res) => {
      const scope = req.query.scope as TodoScope | undefined;
      const status = req.query.status as TodoStatus | undefined;
      const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
      res.json(todosRepo.list(getAdminId(), { scope, status, categoryId }));
    }),
  );
  app.post(
    '/api/todos',
    h((req, res) => {
      const { title, category_id, scope, due_date, recurrence_freq, reminder_time, duration_minutes } = req.body ?? {};
      if (!title) return res.status(400).json({ error: 'title requerido' });

      const adminId = getAdminId();

      if (scope === 'routine') {
        if (!reminder_time || !duration_minutes) {
          return res.status(400).json({ error: 'Las rutinas necesitan reminder_time y duration_minutes' });
        }
        const admin = usersRepo.getById(adminId)!;
        const id = createRoutineWithReminders(adminId, admin.jid, {
          title,
          categoryId: category_id ?? null,
          freq: recurrence_freq === 'weekly' ? 'weekly' : 'daily',
          reminderTime: reminder_time,
          durationMinutes: Number(duration_minutes),
        });
        return res.json({ id });
      }

      const id = todosRepo.create(adminId, {
        title,
        categoryId: category_id ?? null,
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
      const adminId = getAdminId();
      const id = Number(req.params.id);
      const todo = todosRepo.getById(adminId, id);
      if (!todo) return res.status(404).json({ error: 'No existe esa tarea' });

      const { title, category_id, due_date, recurrence_freq, reminder_time, duration_minutes } = req.body ?? {};

      if (todo.scope === 'routine') {
        const ok = updateRoutineWithReminders(adminId, id, {
          title: title || undefined,
          categoryId: category_id === undefined ? undefined : category_id,
          freq: recurrence_freq === 'weekly' ? 'weekly' : recurrence_freq === 'daily' ? 'daily' : undefined,
          reminderTime: reminder_time || undefined,
          durationMinutes: duration_minutes === undefined ? undefined : Number(duration_minutes),
        });
        if (!ok) return res.status(404).json({ error: 'No existe esa rutina' });
        return res.json({ ok: true });
      }

      todosRepo.update(adminId, id, {
        title: title || undefined,
        categoryId: category_id === undefined ? undefined : category_id,
        dueDate: due_date === undefined ? undefined : due_date,
      });
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/todos/:id/complete',
    h((req, res) => {
      todosRepo.complete(getAdminId(), Number(req.params.id));
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/todos/:id',
    h((req, res) => {
      todosRepo.remove(getAdminId(), Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  // ---------- Habit logs (routine check-ins) ----------
  app.get(
    '/api/todos/:id/history',
    h((req, res) => {
      const days = req.query.days ? Number(req.query.days) : 30;
      res.json({
        history: habitLogsRepo.history(Number(req.params.id), days),
        streak: habitLogsRepo.currentStreak(Number(req.params.id), todayLocal()),
      });
    }),
  );
  app.post(
    '/api/todos/:id/checkin',
    h((req, res) => {
      const { date, done, note } = req.body ?? {};
      const logDate = date || todayLocal();
      habitLogsRepo.checkIn(Number(req.params.id), logDate, done !== false, note || null);
      res.json({ ok: true });
    }),
  );

  // ---------- Rewards & punishments ----------
  app.get(
    '/api/rewards',
    h((req, res) => {
      const type = req.query.type as RewardPunishmentType | undefined;
      const todoId = req.query.todoId ? Number(req.query.todoId) : undefined;
      const adminId = getAdminId();
      res.json(todoId ? rewardsRepo.listByTodo(adminId, todoId) : rewardsRepo.listAll(adminId, type));
    }),
  );
  app.post(
    '/api/rewards',
    h((req, res) => {
      const { type, description, todo_id, note, date } = req.body ?? {};
      if (type !== 'reward' && type !== 'punishment') return res.status(400).json({ error: 'type debe ser reward o punishment' });
      if (!description) return res.status(400).json({ error: 'description requerida' });
      const id = rewardsRepo.create(getAdminId(), {
        type,
        description,
        todoId: todo_id ?? null,
        note: note || null,
        date: date || todayLocal(),
      });
      res.json({ id });
    }),
  );
  app.delete(
    '/api/rewards/:id',
    h((req, res) => {
      rewardsRepo.remove(getAdminId(), Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  return app;
}
