import { join } from 'node:path';
import type { Express, Request, Response } from 'express';
import { env } from '../../config/env.js';
import { PORTAL_PATH, landingUrl } from '../../services/growth/urls.js';
import { registerSiteRoutes } from '../../services/growth/site.service.js';

import { rateLimit } from '../middleware/security.middleware.js';
import { h, userId, int } from '../http-helpers.js';
import { requestDemo, DemoError, extendDemo, convertDemo } from '../../services/growth/demo.service.js';
import { recordClientEvent, recordServerEvent, visitorId, analyticsReport } from '../../services/growth/analytics.service.js';
import type { BotManager } from '../../channels/whatsapp/bot-manager.js';
import { PUBLIC_DIR } from '../../config/paths.js';

const PORTAL_FILE = join(PUBLIC_DIR, 'index.html');

export function registerPublicRoutes(app: Express, bot: BotManager): void {
  // Public site: home, use-case and legal pages, robots/sitemap/llms.txt (see ./site.ts).
  registerSiteRoutes(app);

  // Portal + administration on the same domain as the sales page. Its assets are relative
  // ("./assets/...") so it must be /app without a trailing slash - /app/ redirects there.
  // (One route: Express' non-strict routing matches "/app" and "/app/" alike, so two separate
  // routes made /app redirect to itself forever.)
  app.get(PORTAL_PATH, (req, res) => {
    if (req.path.endsWith('/')) return res.redirect(301, PORTAL_PATH);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(PORTAL_FILE);
  });

  app.get(
    '/api/public/config',
    h((_req, res) => {
      res.json({ contactWhatsapp: env.growth.contactWhatsapp, botWhatsapp: bot.session.ownPhone(), demoHours: env.growth.demoHours });
    }),
  );

  app.post(
    '/api/public/demo',
    rateLimit({ capacity: 3, windowMs: 60 * 60_000, message: 'Ya pediste varias demos. Intenta más tarde o escríbenos por WhatsApp.' }),
    h((req, res) => {
      if (req.body?.website) return void res.json({ ok: true }); // honeypot: bots fill every field
      const botPhone = bot.session.ownPhone();
      if (!botPhone) return void res.status(503).json({ error: 'El asistente se está reconectando. Intenta en unos minutos.' });
      try {
        const visitor = visitorId(req);
        const { code } = requestDemo({ name: String(req.body?.name ?? ''), interest: req.body?.interest ? String(req.body.interest) : null, visitor });
        recordServerEvent('demo_request', code, visitor);
        res.json({
          code,
          demoHours: env.growth.demoHours,
          botWhatsapp: botPhone,
          whatsappUrl: `https://wa.me/${botPhone}?text=${encodeURIComponent(`Hola Canix 👋 quiero activar mi demo: ${code}`)}`,
        });
      } catch (err) {
        if (err instanceof DemoError) return void res.status(400).json({ error: err.message });
        throw err;
      }
    }),
  );

  app.post(
    '/api/public/track',
    rateLimit({ capacity: 120, windowMs: 60_000 }),
    (req: Request, res: Response) => {
      try {
        recordClientEvent(req, (req.body ?? {}) as Record<string, unknown>);
      } catch (err) {
        console.error('[ANALYTICS] Event discarded:', (err as Error).message);
      }
      res.status(204).end();
    },
  );
}

/** Admin-only (registered after /api/admin's requirePanelAdmin middleware). */
export function registerGrowthAdminRoutes(app: Express, userView: (u: never) => unknown): void {
  app.get(
    '/api/admin/analytics',
    h((req, res) => {
      const days = Math.min(Math.max(int(req.query.days) ?? 30, 1), 365);
      res.json({ ...analyticsReport(days), landingUrl: landingUrl() });
    }),
  );

  app.post(
    '/api/admin/users/:id/demo',
    h((req, res) => {
      const action = String(req.body?.action ?? '');
      try {
        const u =
          action === 'extend'
            ? extendDemo(userId(req), Number(req.params.id), Number(req.body?.hours ?? 24))
            : action === 'convert'
              ? convertDemo(userId(req), Number(req.params.id))
              : null;
        if (!u) return void res.status(400).json({ error: 'Acción inválida.' });
        res.json((userView as (u: unknown) => unknown)(u));
      } catch (err) {
        if (err instanceof DemoError) return void res.status(400).json({ error: err.message });
        throw err;
      }
    }),
  );
}
