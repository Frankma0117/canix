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
import { todayLocal } from '../util/datetime.js';
import { phoneToJid } from '../util/jid.js';
import { requireAdminToken, validateLogin } from './auth.js';
import type { RecurrenceFreq, TodoScope, TodoStatus, ReminderStatus } from '../types/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', '..', 'public');

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

  // ---------- Categories ----------
  app.get('/api/categories', h((_req, res) => res.json(categoriesRepo.listAll())));
  app.post(
    '/api/categories',
    h((req, res) => {
      const { name, description } = req.body ?? {};
      if (!name) return res.status(400).json({ error: 'name requerido' });
      const id = categoriesRepo.create(name, description || null);
      res.json({ id });
    }),
  );
  app.put(
    '/api/categories/:id',
    h((req, res) => {
      categoriesRepo.update(Number(req.params.id), req.body ?? {});
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/categories/:id',
    h((req, res) => {
      categoriesRepo.remove(Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  // ---------- Links ----------
  app.get(
    '/api/links',
    h((req, res) => {
      const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
      res.json(linksRepo.listByCategory(categoryId));
    }),
  );
  app.post(
    '/api/links',
    h((req, res) => {
      const { url, category_id, title, description } = req.body ?? {};
      if (!url) return res.status(400).json({ error: 'url requerida' });
      const id = linksRepo.create({
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
      linksRepo.remove(Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  // ---------- Contacts ----------
  app.get('/api/contacts', h((_req, res) => res.json(contactsRepo.listAll())));
  app.post(
    '/api/contacts',
    h((req, res) => {
      const { name, phone, notes } = req.body ?? {};
      if (!name || !phone) return res.status(400).json({ error: 'name y phone requeridos' });
      const contact = contactsRepo.upsert(name, phoneToJid(phone), notes || null);
      res.json(contact);
    }),
  );
  app.delete(
    '/api/contacts/:id',
    h((req, res) => {
      contactsRepo.remove(Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  // ---------- Reminders ----------
  app.get(
    '/api/reminders',
    h((req, res) => {
      const status = req.query.status as ReminderStatus | undefined;
      const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
      res.json(categoryId ? remindersRepo.listByCategory(categoryId, status) : remindersRepo.listAll(status));
    }),
  );
  app.post(
    '/api/reminders/:id/cancel',
    h((req, res) => {
      remindersRepo.cancel(Number(req.params.id));
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
      res.json(todosRepo.list({ scope, status, categoryId }));
    }),
  );
  app.post(
    '/api/todos',
    h((req, res) => {
      const { title, category_id, scope, due_date, recurrence_freq } = req.body ?? {};
      if (!title) return res.status(400).json({ error: 'title requerido' });
      const id = todosRepo.create({
        title,
        categoryId: category_id ?? null,
        scope: scope || 'today',
        dueDate: due_date || (scope === 'today' ? todayLocal() : null),
        recurrenceFreq: (recurrence_freq as RecurrenceFreq) ?? null,
      });
      res.json({ id });
    }),
  );
  app.post(
    '/api/todos/:id/complete',
    h((req, res) => {
      todosRepo.complete(Number(req.params.id));
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/todos/:id',
    h((req, res) => {
      todosRepo.remove(Number(req.params.id));
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

  return app;
}
