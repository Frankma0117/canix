import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express, Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { LANDING_PATH, PORTAL_PATH, landingUrl } from './urls.js';

export { landingUrl, portalUrl } from './urls.js';
import { rateLimit } from '../server/security.js';
import { h, userId, int } from '../server/http-helpers.js';
import { requestDemo, DemoError, extendDemo, convertDemo } from './demo.js';
import { recordClientEvent, recordServerEvent, visitorId, analyticsReport } from './analytics.js';
import type { BotManager } from '../whatsapp/bot-manager.js';

const here = dirname(fileURLToPath(import.meta.url));
const LANDING_FILE = join(here, '..', '..', 'public', 'conoce', 'index.html');
const PORTAL_FILE = join(here, '..', '..', 'public', 'index.html');

let cache: { mtime: number; html: string } | null = null;

function landingHost(): string | null {
  try {
    return env.growth.landingUrl ? new URL(env.growth.landingUrl).hostname : null;
  } catch {
    return null;
  }
}

/**
 * The built landing page (admin-panel/conoce/index.html -> public/conoce/index.html) with the
 * server-side values filled in, so crawlers get the final canonical URL / contact link in plain HTML.
 */
function landingHtml(): string | null {
  let mtime: number;
  try {
    mtime = statSync(LANDING_FILE).mtimeMs;
  } catch {
    return null;
  }
  if (!cache || cache.mtime !== mtime) cache = { mtime, html: readFileSync(LANDING_FILE, 'utf8') };
  const url = landingUrl();
  const origin = url.startsWith('http') ? new URL(url).origin : '';
  const contact = `https://wa.me/${env.growth.contactWhatsapp}?text=${encodeURIComponent('Hola, estoy interesado en adquirir Canix, el asistente personal por WhatsApp. ¿Me cuentan más?')}`;
  const gsv = env.growth.googleSiteVerification.replace(/[^A-Za-z0-9_-]/g, '');
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  let html = cache.html
    .replaceAll('{{CANONICAL}}', esc(url))
    .replaceAll('{{ORIGIN}}', esc(origin))
    .replaceAll('{{CONTACT_URL}}', esc(contact))
    .replaceAll('{{DEMO_HOURS}}', String(env.growth.demoHours));
  html = gsv
    ? html.replace('{{GSV}}', gsv)
    : html.replace(/<meta name="google-site-verification" content="\{\{GSV\}\}"\s*\/?>/, '');
  return html;
}

function sendLanding(res: Response): void {
  const html = landingHtml();
  if (!html) {
    res.status(503).send('La página todavía no está compilada (npm run build en admin-panel).');
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.type('html').send(html);
}

export function registerPublicRoutes(app: Express, bot: BotManager): void {
  const isLandingHost = (req: Request) => landingHost() !== null && req.hostname === landingHost();

  // The landing at "/" on its own host, and at /conoce everywhere (works before any DNS change).
  app.get('/', (req: Request, res: Response, next: NextFunction) => (isLandingHost(req) ? sendLanding(res) : next()));
  app.get([LANDING_PATH, `${LANDING_PATH}/`], (_req, res) => sendLanding(res));

  // Portal + administration on the same domain as the sales page. Its assets are relative
  // ("./assets/...") so it must be /app without a trailing slash - /app/ redirects there.
  // (One route: Express' non-strict routing matches "/app" and "/app/" alike, so two separate
  // routes made /app redirect to itself forever.)
  app.get(PORTAL_PATH, (req, res) => {
    if (req.path.endsWith('/')) return res.redirect(301, PORTAL_PATH);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(PORTAL_FILE);
  });

  app.get('/robots.txt', (req, res) => {
    const sitemap = `${landingUrl().startsWith('http') ? new URL(landingUrl()).origin : ''}/sitemap.xml`;
    res.type('text/plain').send(
      isLandingHost(req)
        ? `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: ${PORTAL_PATH}\nSitemap: ${sitemap}\n`
        : // the portal host: only the public page is indexable, the private portal is not
          `User-agent: *\nAllow: ${LANDING_PATH}\nDisallow: /\nSitemap: ${sitemap}\n`,
    );
  });

  app.get('/sitemap.xml', (_req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        `  <url><loc>${landingUrl()}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>\n` +
        `</urlset>\n`,
    );
  });

  // ---------- public API (no auth) ----------
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
        console.error('[ANALYTICS] Evento descartado:', (err as Error).message);
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
