import express, { type Express, type NextFunction, type Request, type Response } from 'express';
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
import { callRemindersRepo } from '../db/repositories/call-reminders.repo.js';
import { createCallReminder, updateCallReminder, testCallNow } from '../calls/call-reminders.service.js';
import { registerCallAudioRoute } from '../calls/call-audio.js';
import { registerTwilioWebhook } from './twilio-webhook.js';
import { createRoutineWithReminders, updateRoutineWithReminders } from '../agent/routine-setup.js';
import { todayLocal, nowLocal } from '../util/datetime.js';
import { phoneToJid } from '../util/jid.js';
import { resolvePanelUser, requirePanelAdmin, requirePermission, extractToken } from './auth.js';
import { login, logout, changePassword, setPassword, createSession, AuthError } from '../auth/web-auth.js';
import { effectivePermissions } from '../permissions/engine.js';
import { PERMISSIONS } from '../permissions/catalog.js';
import { securityHeaders, rateLimit, requestTimeout, errorHandler } from './security.js';
import { h, userId } from './http-helpers.js';
import { registerAdminRoutes } from './admin-routes.js';
import { registerSchedulingRoutes } from './scheduling-routes.js';
import { registerModuleRoutes } from './module-routes.js';
import type { User } from '../types/index.js';
import type {
  RecurrenceFreq,
  TodoScope,
  TodoStatus,
  ReminderStatus,
  RewardPunishmentType,
  CallReminderStatus,
} from '../types/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', '..', 'public');

export function createServer(bot: BotManager): Express {
  const app = express();
  // Needed so req.protocol correctly reflects "https" (via X-Forwarded-Proto) when this app runs
  // behind a reverse proxy/TLS terminator - Twilio's webhook signature validation (see
  // server/twilio-webhook.ts) reconstructs the exact public URL it called, and gets it wrong
  // without this if the proxy doesn't terminate TLS at this same process.
  // Only the first hop (the reverse proxy in front of this app) is trusted for X-Forwarded-For -
  // trusting the whole chain would let anyone spoof their IP and dodge the per-IP rate limits.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  // No CORS: the portal is served from this same origin, so cross-origin browser calls to the API
  // are simply not allowed (they used to be, for any site).

  // Twilio's status-callback webhook - registered BEFORE express.json() below and outside /api on
  // purpose: it's unauthenticated by our own Bearer scheme (Twilio can't send it) and needs its
  // own express.urlencoded() body parser instead of JSON (see twilio-webhook.ts).
  registerTwilioWebhook(app);
  // Natural-voice MP3s for calls (see calls/call-audio.ts) - public on purpose, Twilio fetches them.
  registerCallAudioRoute(app);

  app.use('/api', requestTimeout(30_000));
  app.use('/api', rateLimit({ capacity: 240, windowMs: 60_000 }));
  app.use(express.json({ limit: '200kb' }));
  app.use(express.static(publicDir, { maxAge: '1h', index: 'index.html' }));

  // ---------- Portal authentication (number + password, see auth/web-auth.ts) ----------
  // Two limits on login: per IP (stops one source hammering many accounts) and per IP+number
  // (stops guessing one account's password) - on top of the per-account lockout in web-auth.ts.
  app.post(
    '/api/auth/login',
    rateLimit({ capacity: 20, windowMs: 15 * 60_000, message: 'Demasiados intentos de ingreso. Espera unos minutos.' }),
    rateLimit({ capacity: 6, windowMs: 15 * 60_000, keyFn: (req) => `${req.ip}:${String(req.body?.phone ?? '').replace(/\D/g, '')}`, message: 'Demasiados intentos para ese número. Espera unos minutos.' }),
    h(async (req, res) => {
      const result = await login(String(req.body?.phone ?? ''), String(req.body?.password ?? ''), {
        ip: req.ip,
        userAgent: req.header('user-agent'),
      });
      res.json({ token: result.token, user: sessionView(result.user), mustChangePassword: result.mustChangePassword });
    }),
  );

  app.use('/api', resolvePanelUser);

  app.get('/api/auth/me', h((req, res) => res.json(sessionView(req.panelUser!))));

  app.post(
    '/api/auth/logout',
    h((req, res) => {
      const token = extractToken(req);
      if (token) logout(token);
      res.json({ ok: true });
    }),
  );

  app.post(
    '/api/auth/change-password',
    rateLimit({ capacity: 10, windowMs: 15 * 60_000, keyFn: (req) => `pwd:${req.panelUser?.id}` }),
    h(async (req, res) => {
      const user = req.panelUser!;
      const current = String(req.body?.current ?? '');
      const next = String(req.body?.next ?? '');
      if (user.password_hash) {
        await changePassword(user, current, next, req.sessionToken);
        return void res.json({ ok: true });
      }
      // The admin's FIRST password (still on the legacy token, no password yet) needs no "current".
      // Setting it retires the legacy token, so a real session is handed back to stay logged in.
      if (user.role !== 'admin') throw new AuthError('No tienes contraseña configurada.', 400);
      await setPassword(user.id, next, { mustChange: false, actorId: user.id });
      res.json({ ok: true, token: createSession(user.id, { ip: req.ip, userAgent: req.header('user-agent') }) });
    }),
  );

  // ---------- Permission gates for the per-module routes below ----------
  app.use('/api/categories', requirePermission('links.manage', 'reminders.manage', 'notes.manage'));
  app.use('/api/links', requirePermission('links.manage'));
  app.use('/api/contacts', requirePermission('contacts.manage'));
  app.use('/api/reminders', requirePermission('reminders.manage'));
  app.use('/api/call-reminders', requirePermission('reminders.calls'));
  app.use('/api/rewards', requirePermission('rewards.manage'));
  app.use('/api/todos', todoPermissionGate);

  // ---------- WhatsApp connection (admin only - it's a single shared WhatsApp session) ----------
  app.use('/api/connection', requirePanelAdmin);
  app.get(
    '/api/connection/status',
    h((_req, res) => {
      const wa = bot.session;
      res.json({
        connection: wa.connectionState,
        connected: wa.isConnected(),
        hasQr: Boolean(wa.qr),
        banSuspected: wa.banSuspected,
        // Anti-ban daily send governor snapshot (see whatsapp/send-guard.ts) - lets the admin panel
        // actually show the safety net is working instead of just trusting it's there.
        sendGuard: wa.sendGuardStats(),
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
  app.get('/api/categories', h((req, res) => res.json(categoriesRepo.listAll(userId(req)))));
  app.post(
    '/api/categories',
    h((req, res) => {
      const { name, description } = req.body ?? {};
      if (!name) return res.status(400).json({ error: 'name requerido' });
      const id = categoriesRepo.create(userId(req), name, description || null);
      res.json({ id });
    }),
  );
  app.put(
    '/api/categories/:id',
    h((req, res) => {
      categoriesRepo.update(userId(req), Number(req.params.id), req.body ?? {});
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/categories/:id',
    h((req, res) => {
      categoriesRepo.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  // ---------- Links ----------
  app.get(
    '/api/links',
    h((req, res) => {
      const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
      res.json(linksRepo.listByCategory(userId(req), categoryId));
    }),
  );
  app.post(
    '/api/links',
    h((req, res) => {
      const { url, category_id, title, description } = req.body ?? {};
      if (!url) return res.status(400).json({ error: 'url requerida' });
      const id = linksRepo.create(userId(req), {
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
      linksRepo.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  // ---------- Contacts ----------
  app.get('/api/contacts', h((req, res) => res.json(contactsRepo.listAll(userId(req)))));
  app.post(
    '/api/contacts',
    h((req, res) => {
      const { name, phone, notes } = req.body ?? {};
      if (!name || !phone) return res.status(400).json({ error: 'name y phone requeridos' });
      const contact = contactsRepo.upsert(userId(req), name, phoneToJid(phone), notes || null);
      res.json(contact);
    }),
  );
  app.delete(
    '/api/contacts/:id',
    h((req, res) => {
      contactsRepo.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  // ---------- Reminders ----------
  app.get(
    '/api/reminders',
    h((req, res) => {
      const status = req.query.status as ReminderStatus | undefined;
      const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
      const uid = userId(req);
      res.json(categoryId ? remindersRepo.listByCategory(uid, categoryId, status) : remindersRepo.listAll(uid, status));
    }),
  );
  app.put(
    '/api/reminders/:id',
    h((req, res) => {
      const uid = userId(req);
      const id = Number(req.params.id);
      const reminder = remindersRepo.getById(uid, id);
      if (!reminder) return res.status(404).json({ error: 'No existe ese recordatorio' });
      if (reminder.kind === 'routine_reminder' || reminder.kind === 'routine_checkin' || reminder.kind === 'daily_agenda') {
        return res.status(400).json({ error: 'Este recordatorio pertenece a una rutina o es automático - edítalo desde su rutina' });
      }
      const { message, run_at, category_id, recurrence_freq, recurrence_interval } = req.body ?? {};
      remindersRepo.update(uid, id, {
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
      remindersRepo.cancel(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/reminders/:id',
    h((req, res) => {
      remindersRepo.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  // ---------- Phone-call reminders (Twilio Programmable Voice, see src/calls/) ----------
  // A separate resource from /api/reminders above (different channel, fields, and status
  // vocabulary - see call-reminders.repo.ts's own comment) - same panel auth (resolvePanelUser
  // already ran for every /api route), so every call reminder is scoped to whoever created it.
  app.get(
    '/api/call-reminders',
    h((req, res) => {
      const status = req.query.status as CallReminderStatus | undefined;
      res.json(callRemindersRepo.listAll(userId(req), status));
    }),
  );
  app.get(
    '/api/call-reminders/:id',
    h((req, res) => {
      const reminder = callRemindersRepo.getById(userId(req), Number(req.params.id));
      if (!reminder) return res.status(404).json({ error: 'No existe ese recordatorio' });
      res.json(reminder);
    }),
  );
  app.post(
    '/api/call-reminders',
    h((req, res) => {
      const { phone_number, message, call_type, scheduled_at, recurrence_freq, recurrence_interval } = req.body ?? {};
      if (!phone_number || !scheduled_at) {
        return res.status(400).json({ error: 'phone_number y scheduled_at son requeridos' });
      }
      if (call_type && call_type !== 'reminder' && call_type !== 'alarm') {
        return res.status(400).json({ error: 'call_type debe ser "reminder" o "alarm"' });
      }
      const result = createCallReminder({
        userId: userId(req),
        phoneNumber: String(phone_number),
        message: String(message ?? ''),
        callType: call_type === 'alarm' ? 'alarm' : 'reminder',
        scheduledAt: String(scheduled_at),
        recurrenceFreq: recurrence_freq as RecurrenceFreq | undefined,
        recurrenceInterval: recurrence_interval === undefined ? undefined : Number(recurrence_interval),
      });
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json(result.value);
    }),
  );
  app.put(
    '/api/call-reminders/:id',
    h((req, res) => {
      const { phone_number, message, call_type, scheduled_at, recurrence_freq, recurrence_interval } = req.body ?? {};
      if (call_type && call_type !== 'reminder' && call_type !== 'alarm') {
        return res.status(400).json({ error: 'call_type debe ser "reminder" o "alarm"' });
      }
      const result = updateCallReminder(userId(req), Number(req.params.id), {
        phoneNumber: phone_number === undefined ? undefined : String(phone_number),
        message: message === undefined ? undefined : String(message),
        callType: call_type as 'reminder' | 'alarm' | undefined,
        scheduledAt: scheduled_at === undefined ? undefined : String(scheduled_at),
        recurrenceFreq: recurrence_freq as RecurrenceFreq | undefined,
        recurrenceInterval: recurrence_interval === undefined ? undefined : Number(recurrence_interval),
      });
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json(result.value);
    }),
  );
  app.post(
    '/api/call-reminders/:id/cancel',
    h((req, res) => {
      const ok = callRemindersRepo.cancel(userId(req), Number(req.params.id));
      if (!ok) return res.status(400).json({ error: 'No se puede cancelar (no existe, o ya terminó)' });
      res.json({ ok: true });
    }),
  );
  // Places the call RIGHT NOW using this reminder's own phone/message, as a separate one-off test
  // row (see calls/call-reminders.service.ts's testCallNow) - the original scheduled reminder is
  // never touched by this, so testing it doesn't consume/advance its real scheduled occurrence.
  app.post(
    '/api/call-reminders/:id/test',
    h(async (req, res) => {
      const uid = userId(req);
      const reminder = callRemindersRepo.getById(uid, Number(req.params.id));
      if (!reminder) return res.status(404).json({ error: 'No existe ese recordatorio' });

      const result = await testCallNow({
        userId: uid,
        phoneNumber: reminder.phone_number,
        message: reminder.message,
        callType: reminder.call_type,
        scheduledAt: nowLocal(),
      });
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json(result.value);
    }),
  );
  app.delete(
    '/api/call-reminders/:id',
    h((req, res) => {
      callRemindersRepo.remove(userId(req), Number(req.params.id));
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
      res.json(todosRepo.list(userId(req), { scope, status, categoryId }));
    }),
  );
  app.post(
    '/api/todos',
    h((req, res) => {
      const { title, category_id, scope, due_date, recurrence_freq, reminder_time, duration_minutes } = req.body ?? {};
      if (!title) return res.status(400).json({ error: 'title requerido' });

      const uid = userId(req);

      if (scope === 'routine') {
        if (!reminder_time || !duration_minutes) {
          return res.status(400).json({ error: 'Las rutinas necesitan reminder_time y duration_minutes' });
        }
        const owner = usersRepo.getById(uid)!;
        const id = createRoutineWithReminders(uid, owner.jid, {
          title,
          categoryId: category_id ?? null,
          freq: recurrence_freq === 'weekly' ? 'weekly' : 'daily',
          reminderTime: reminder_time,
          durationMinutes: Number(duration_minutes),
        });
        return res.json({ id });
      }

      const id = todosRepo.create(uid, {
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
      const uid = userId(req);
      const id = Number(req.params.id);
      const todo = todosRepo.getById(uid, id);
      if (!todo) return res.status(404).json({ error: 'No existe esa tarea' });

      const { title, category_id, due_date, recurrence_freq, reminder_time, duration_minutes } = req.body ?? {};

      if (todo.scope === 'routine') {
        const ok = updateRoutineWithReminders(uid, id, {
          title: title || undefined,
          categoryId: category_id === undefined ? undefined : category_id,
          freq: recurrence_freq === 'weekly' ? 'weekly' : recurrence_freq === 'daily' ? 'daily' : undefined,
          reminderTime: reminder_time || undefined,
          durationMinutes: duration_minutes === undefined ? undefined : Number(duration_minutes),
        });
        if (!ok) return res.status(404).json({ error: 'No existe esa rutina' });
        return res.json({ ok: true });
      }

      todosRepo.update(uid, id, {
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
      todosRepo.complete(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/todos/:id',
    h((req, res) => {
      todosRepo.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  // ---------- Habit logs (routine check-ins) ----------
  // habit_logs rows are keyed by todo_id alone (no user_id column) - ownership must be checked via
  // the parent todo before touching them, otherwise one client could read/edit another's habit
  // history just by guessing/incrementing a todo id. Harmless back when the panel was admin-only
  // (there was only ever one possible owner), a real cross-tenant leak now that every client has a
  // token (see auth.js's resolvePanelUser).
  app.get(
    '/api/todos/:id/history',
    h((req, res) => {
      const id = Number(req.params.id);
      if (!todosRepo.getById(userId(req), id)) return res.status(404).json({ error: 'No existe esa rutina' });
      const days = req.query.days ? Number(req.query.days) : 30;
      res.json({
        history: habitLogsRepo.history(id, days),
        streak: habitLogsRepo.currentStreak(id, todayLocal()),
      });
    }),
  );
  app.post(
    '/api/todos/:id/checkin',
    h((req, res) => {
      const id = Number(req.params.id);
      if (!todosRepo.getById(userId(req), id)) return res.status(404).json({ error: 'No existe esa rutina' });
      const { date, done, note } = req.body ?? {};
      const logDate = date || todayLocal();
      habitLogsRepo.checkIn(id, logDate, done !== false, note || null);
      res.json({ ok: true });
    }),
  );

  // ---------- Rewards & punishments ----------
  app.get(
    '/api/rewards',
    h((req, res) => {
      const type = req.query.type as RewardPunishmentType | undefined;
      const todoId = req.query.todoId ? Number(req.query.todoId) : undefined;
      const uid = userId(req);
      res.json(todoId ? rewardsRepo.listByTodo(uid, todoId) : rewardsRepo.listAll(uid, type));
    }),
  );
  app.post(
    '/api/rewards',
    h((req, res) => {
      const { type, description, todo_id, note, date } = req.body ?? {};
      if (type !== 'reward' && type !== 'punishment') return res.status(400).json({ error: 'type debe ser reward o punishment' });
      if (!description) return res.status(400).json({ error: 'description requerida' });
      const id = rewardsRepo.create(userId(req), {
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
      rewardsRepo.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  registerModuleRoutes(app);
  registerSchedulingRoutes(app);
  registerAdminRoutes(app, bot);

  // Unknown API path -> JSON 404 (never the SPA's index.html).
  app.use('/api', (_req, res) => void res.status(404).json({ error: 'Ruta no encontrada.' }));
  app.use(errorHandler);

  return app;
}

/** What the portal needs to know about the logged-in person to build its navigation. */
function sessionView(user: User) {
  const perms = effectivePermissions(user);
  return {
    id: user.id,
    name: user.name,
    phone: user.jid.split('@')[0],
    role: user.role,
    permissions: [...perms],
    modules: [...new Set(PERMISSIONS.filter((p) => perms.has(p.key)).map((p) => p.module))],
    mustChangePassword: !!user.must_change_password,
    hasPassword: !!user.password_hash,
  };
}

/**
 * /api/todos serves both one-off tasks (todos.manage) and routines (routines.manage) - the scope
 * comes from the query/body, or from the existing row for /:id routes.
 */
function todoPermissionGate(req: Request, res: Response, next: NextFunction): void {
  const perms = req.panelPermissions!;
  if (req.panelUser?.role === 'admin') return next();
  let scope = String(req.query.scope ?? req.body?.scope ?? '');
  const idMatch = /^\/(\d+)/.exec(req.path);
  if (!scope && idMatch) scope = todosRepo.getById(req.panelUser!.id, Number(idMatch[1]))?.scope ?? '';
  const needed = scope === 'routine' ? 'routines.manage' : scope ? 'todos.manage' : null;
  const ok = needed ? perms.has(needed) : perms.has('todos.manage') || perms.has('routines.manage');
  if (ok) return next();
  res.status(403).json({ error: 'No tienes habilitado este módulo. Pídeselo al administrador.' });
}
