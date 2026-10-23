import express, { type Express } from 'express';
import type { BotManager } from '../channels/whatsapp/bot-manager.js';
import { registerCallAudioRoute } from '../services/calls/call-audio.service.js';
import { registerTwilioWebhook } from './routes/twilio-webhook.routes.js';
import { jidToPhone } from '../shared/utils/jid.js';
import { resolvePanelUser, requirePermission, extractToken } from './middleware/auth.middleware.js';
import { login, logout, changePassword, setPassword, createSession, AuthError } from '../services/auth/web-auth.service.js';
import { effectivePermissions, testModeOf } from '../services/permissions/permissions.service.js';
import { PERMISSIONS } from '../services/permissions/catalog.js';
import { securityHeaders, rateLimit, requestTimeout, errorHandler } from './middleware/security.middleware.js';
import { h } from './http-helpers.js';
import { registerAdminRoutes } from './routes/admin.routes.js';
import { registerPublicRoutes } from './routes/growth.routes.js';
import { registerNotFound } from '../services/growth/site.service.js';
import { registerSchedulingRoutes } from './routes/scheduling.routes.js';
import { registerConnectionRoutes } from './routes/connection.routes.js';
import { registerCategoryRoutes } from './routes/categories.routes.js';
import { registerLinkRoutes } from './routes/links.routes.js';
import { registerContactRoutes } from './routes/contacts.routes.js';
import { registerReminderRoutes } from './routes/reminders.routes.js';
import { registerCallReminderRoutes } from './routes/call-reminders.routes.js';
import { registerTodoRoutes } from './routes/todos.routes.js';
import { registerRoutineRoutes } from './routes/routines.routes.js';
import { registerRewardRoutes } from './routes/rewards.routes.js';
import { registerVoiceRoutes } from './routes/voices.routes.js';
import { registerNoteRoutes } from './routes/notes.routes.js';
import { registerMealRoutes } from './routes/meals.routes.js';
import { registerRecipeRoutes } from './routes/recipes.routes.js';
import { registerListRoutes } from './routes/lists.routes.js';
import { registerWardrobeRoutes } from './routes/wardrobe.routes.js';
import { registerLibraryRoutes } from './routes/library.routes.js';
import { registerMedicationRoutes } from './routes/medications.routes.js';
import { registerWorkoutRoutes } from './routes/workouts.routes.js';
import { registerCalendarRoutes } from './routes/calendar.routes.js';
import { registerStickerRoutes } from './routes/stickers.routes.js';
import type { User } from '../entities/index.js';
import { PUBLIC_DIR } from '../config/paths.js';

const publicDir = PUBLIC_DIR;

export function createServer(bot: BotManager): Express {
  const app = express();
  // Needed so req.protocol correctly reflects "https" (via X-Forwarded-Proto) when this app runs
  // behind a reverse proxy/TLS terminator - Twilio's webhook signature validation (see
  // api/routes/twilio-webhook.routes.ts) reconstructs the exact public URL it called, and gets it wrong
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
  // own express.urlencoded() body parser instead of JSON (see twilio-webhook.routes.ts).
  registerTwilioWebhook(app);
  // Natural-voice MP3s for calls (see services/calls/call-audio.service.ts) - public on purpose, Twilio fetches them.
  registerCallAudioRoute(app);

  app.use('/api', requestTimeout(30_000));
  app.use('/api', rateLimit({ capacity: 240, windowMs: 60_000 }));
  app.use(express.json({ limit: '200kb' }));
  // Public sales page (+ robots/sitemap) and its unauthenticated API: demo requests and analytics.
  // Before express.static so the landing host gets the landing at "/" instead of the portal.
  registerPublicRoutes(app, bot);
  app.use(express.static(publicDir, { maxAge: '1h', index: 'index.html' }));

  // ---------- Portal authentication (number + password, see services/auth/web-auth.service.ts) ----------
  // Two limits on login: per IP (stops one source hammering many accounts) and per IP+number
  // (stops guessing one account's password) - on top of the per-account lockout in web-auth.service.ts.
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
  app.use('/api/categories', requirePermission('links.manage', 'reminders.manage', 'notes.manage', 'todos.manage', 'recipes.manage'));
  app.use('/api/links', requirePermission('links.manage'));
  app.use('/api/contacts', requirePermission('contacts.manage'));
  app.use('/api/reminders', requirePermission('reminders.manage'));
  app.use('/api/call-reminders', requirePermission('reminders.calls'));
  app.use('/api/rewards', requirePermission('rewards.manage'));
  app.use('/api/routines', requirePermission('routines.manage'));
  app.use('/api/voices', requirePermission('voice.premium'));
  app.use('/api/reminder-responses', requirePermission('reminders.manage', 'routines.manage', 'workouts.manage'));

  registerConnectionRoutes(app, bot);
  registerCategoryRoutes(app);
  registerLinkRoutes(app);
  registerContactRoutes(app);
  registerReminderRoutes(app);
  registerCallReminderRoutes(app);
  registerTodoRoutes(app);
  registerRoutineRoutes(app);
  registerRewardRoutes(app);
  registerVoiceRoutes(app);
  registerNoteRoutes(app);
  registerMealRoutes(app);
  registerRecipeRoutes(app);
  registerListRoutes(app);
  registerWardrobeRoutes(app);
  registerLibraryRoutes(app);
  registerMedicationRoutes(app);
  registerWorkoutRoutes(app);
  registerCalendarRoutes(app);
  registerStickerRoutes(app);
  registerSchedulingRoutes(app);
  registerAdminRoutes(app, bot);

  // Unknown API path -> JSON 404 (never the SPA's index.html).
  app.use('/api', (_req, res) => void res.status(404).json({ error: 'Ruta no encontrada.' }));
  // Unknown page -> branded 404 (a real 404 status, so search engines drop dead links).
  registerNotFound(app);
  app.use(errorHandler);

  return app;
}

/** What the portal needs to know about the logged-in person to build its navigation. */
function sessionView(user: User) {
  const perms = effectivePermissions(user);
  return {
    id: user.id,
    name: user.name,
    phone: jidToPhone(user.jid) ?? user.jid.split('@')[0],
    phoneKnown: !!jidToPhone(user.jid),
    role: user.role,
    permissions: [...perms],
    modules: [...new Set(PERMISSIONS.filter((p) => perms.has(p.key)).map((p) => p.module))],
    mustChangePassword: !!user.must_change_password,
    hasPassword: !!user.password_hash,
    // Administrator only: the reduced access they're trying on WhatsApp (the portal stays complete).
    testMode: testModeOf(user),
  };
}
