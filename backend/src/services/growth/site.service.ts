import { readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import type { Express, Request, Response, NextFunction } from 'express';
import { env } from '../../config/env.js';
import { LANDING_PATH, PORTAL_PATH, landingUrl } from './urls.js';
import { PUBLIC_DIR } from '../../config/paths.js';

/**
 * The public sales site: home + use-case pages + legal pages, built by Vite from
 * frontend/landing/<slug>/index.html into public/landing/<slug>/index.html (see
 * frontend/vite.config.ts) and served here with the server-side values filled in, so crawlers
 * get final canonical URLs, contact links and verification tags in plain HTML.
 */

const SITE_DIR = join(PUBLIC_DIR, 'landing');

interface SitePage {
  path: string;
  /** Folder under public/conoce ('' = the home page). */
  dir: string;
  changefreq: 'weekly' | 'monthly' | 'yearly';
  priority: number;
}

/** Every indexable public page - a new frontend/landing/<slug>/index.html must be added here. */
const SITE_PAGES: SitePage[] = [
  { path: '/', dir: '', changefreq: 'weekly', priority: 1.0 },
  { path: '/agenda-de-citas-por-whatsapp', dir: 'agenda-de-citas-por-whatsapp', changefreq: 'monthly', priority: 0.9 },
  { path: '/recordatorios-por-whatsapp', dir: 'recordatorios-por-whatsapp', changefreq: 'monthly', priority: 0.9 },
  { path: '/rutinas-y-habitos', dir: 'rutinas-y-habitos', changefreq: 'monthly', priority: 0.8 },
  { path: '/privacidad', dir: 'privacidad', changefreq: 'yearly', priority: 0.3 },
  { path: '/terminos', dir: 'terminos', changefreq: 'yearly', priority: 0.3 },
];

const fileOf = (p: SitePage) => join(SITE_DIR, p.dir, 'index.html');

/** Origin of the public site: LANDING_URL's, else PANEL_URL's (pages then live under /conoce). */
function siteOrigin(): string {
  const url = landingUrl();
  return url.startsWith('http') ? new URL(url).origin : '';
}

/** Canonical absolute URL of a page ("https://canix.cania.app/" for the home). */
function pageUrl(path: string): string {
  if (env.growth.landingUrl) return `${siteOrigin()}${path}`;
  return path === '/' ? landingUrl() : `${siteOrigin()}${LANDING_PATH}${path}`;
}

function isLandingHost(req: Request): boolean {
  try {
    return !!env.growth.landingUrl && req.hostname === new URL(env.growth.landingUrl).hostname;
  } catch {
    return false;
  }
}

// ---------- per-page "last modified" that only moves when the page's text really changes ----------
// (Vite rewrites every file on each build, so file mtimes would bump every page on every deploy and
// Google learns to ignore lastmod; IndexNow would also be pinged for nothing.)

const STATE_FILE = join(dirname(env.db.path), 'site-pages.json');
interface SiteState {
  pages: Record<string, { hash: string; lastmod: string }>;
  /** Hashes last pushed to IndexNow. */
  indexNow?: string;
}
let state: SiteState | null = null;
let stateKey = '';

function mtimeOf(p: SitePage): number {
  try {
    return statSync(fileOf(p)).mtimeMs;
  } catch {
    return 0;
  }
}

function saveState(s: SiteState): void {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(s, null, 1));
  } catch (err) {
    console.warn('[SEO] Could not save', STATE_FILE, (err as Error).message);
  }
}

function siteState(): SiteState {
  const key = SITE_PAGES.map(mtimeOf).join('|');
  if (state && key === stateKey) return state;
  let prev: SiteState = { pages: {} };
  try {
    prev = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as SiteState;
  } catch {
    /* first run */
  }
  const today = new Date().toISOString().slice(0, 10);
  const pages: SiteState['pages'] = {};
  for (const p of SITE_PAGES) {
    let html: string;
    try {
      html = readFileSync(fileOf(p), 'utf8');
    } catch {
      continue;
    }
    // Hashed asset names change with any CSS/JS tweak - only the page's own content counts.
    const hash = createHash('sha1').update(html.replace(/assets\/[\w.-]+/g, '')).digest('hex').slice(0, 16);
    const old = prev.pages?.[p.path];
    pages[p.path] = old?.hash === hash ? old : { hash, lastmod: today };
  }
  state = { ...prev, pages };
  stateKey = key;
  if (JSON.stringify(prev.pages) !== JSON.stringify(pages)) saveState(state);
  return state;
}

const attr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const token = (v: string) => v.replace(/[^A-Za-z0-9_.-]/g, '');

function contactUrl(): string {
  return `https://wa.me/${env.growth.contactWhatsapp}?text=${encodeURIComponent('Hola, estoy interesado en adquirir Canix, el asistente personal por WhatsApp. ¿Me cuentan más?')}`;
}

function verificationTags(): string {
  const g = env.growth;
  return [
    token(g.googleSiteVerification) && `<meta name="google-site-verification" content="${token(g.googleSiteVerification)}" />`,
    token(g.bingSiteVerification) && `<meta name="msvalidate.01" content="${token(g.bingSiteVerification)}" />`,
    token(g.facebookDomainVerification) && `<meta name="facebook-domain-verification" content="${token(g.facebookDomainVerification)}" />`,
  ]
    .filter(Boolean)
    .join('\n    ');
}

const cache = new Map<string, { mtime: number; html: string }>();

function pageHtml(p: SitePage): string | null {
  const file = fileOf(p);
  let mtime: number;
  try {
    mtime = statSync(file).mtimeMs;
  } catch {
    return null;
  }
  let entry = cache.get(file);
  if (!entry || entry.mtime !== mtime) {
    entry = { mtime, html: readFileSync(file, 'utf8') };
    cache.set(file, entry);
  }
  const g = env.growth;
  const email = g.contactEmail.trim();
  const emailLink = email ? `<a href="mailto:${attr(email)}">${attr(email)}</a>` : '';
  // JSON inside <script>: "</" must never appear literally.
  const sameAs = JSON.stringify(g.socialLinks).replace(/</g, '\\u003c');
  return entry.html
    .replaceAll('{{CANONICAL}}', attr(pageUrl(p.path)))
    .replaceAll('{{ORIGIN}}', attr(siteOrigin()))
    .replaceAll('{{CONTACT_URL}}', attr(contactUrl()))
    .replaceAll('{{CONTACT_PHONE}}', g.contactWhatsapp)
    .replaceAll('{{DEMO_HOURS}}', String(g.demoHours))
    .replaceAll('{{SAME_AS}}', sameAs)
    .replaceAll('{{LEGAL_NAME}}', attr(g.legalName))
    .replaceAll('{{LEGAL_ID}}', g.legalId.trim() ? `, identificado con ${attr(g.legalId.trim())}` : '')
    .replaceAll('{{LEGAL_ADDRESS}}', attr(g.legalAddress))
    .replaceAll('{{CONTACT_EMAIL}}', emailLink ? `${emailLink} · ` : '')
    .replaceAll('{{CONTACT_EMAIL_SENTENCE}}', emailLink ? ` o al correo ${emailLink}` : '')
    .replace('<!--@verify-->', verificationTags());
}

function sendPage(res: Response, p: SitePage): void {
  const html = pageHtml(p);
  if (!html) {
    res.status(503).send('La página todavía no está compilada (npm run build en frontend).');
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.type('html').send(html);
}

function sitemapXml(): string {
  const urls = SITE_PAGES.map((p) => {
    const mod = siteState().pages[p.path]?.lastmod;
    return (
      `  <url><loc>${pageUrl(p.path)}</loc>` +
      (mod ? `<lastmod>${mod}</lastmod>` : '') +
      `<changefreq>${p.changefreq}</changefreq><priority>${p.priority.toFixed(1)}</priority></url>`
    );
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/** https://llmstxt.org - a plain summary for AI assistants and answer engines. */
function llmsTxt(): string {
  const u = pageUrl;
  return `# Canix

> Canix es un asistente personal con inteligencia artificial que funciona dentro de WhatsApp, en español, hecho en Colombia para Latinoamérica. Las personas le escriben o le mandan notas de voz y Canix organiza recordatorios, rutinas y hábitos, tareas, notas, links, contactos, comidas y la agenda de citas de profesionales. Incluye un portal web. Se puede probar gratis por ${env.growth.demoHours} horas.

## Páginas
- [Inicio](${u('/')}): qué es Canix, funciones, modos, planes, demo gratis y preguntas frecuentes.
- [Recordatorios por WhatsApp](${u('/recordatorios-por-whatsapp')}): recordatorios únicos, recurrentes, flexibles, temporizadores, fechas importantes y llamadas telefónicas.
- [Rutinas y hábitos](${u('/rutinas-y-habitos')}): seguimiento de hábitos con chequeo diario, rachas, historial, ejercicios, premios y resumen semanal.
- [Agenda de citas por WhatsApp](${u('/agenda-de-citas-por-whatsapp')}): para psicólogos, médicos, odontólogos, estéticas, coaches y entrenadores; los clientes piden cita por WhatsApp y ambos reciben recordatorios.
- [Política de privacidad](${u('/privacidad')})
- [Términos y condiciones](${u('/terminos')})

## Datos clave
- Funciona en: WhatsApp (sin instalar apps) y portal web.
- Idioma: español.
- Planes: Personal, Profesional y Familias/Equipos; se cotizan por WhatsApp. Extras opcionales: llamadas telefónicas y voz natural.
- Contacto: ${contactUrl()}
`;
}

// ---------- IndexNow: tell Bing & co. about new/changed pages, once per change ----------

async function pingIndexNow(): Promise<void> {
  const key = env.growth.indexNowKey;
  const origin = siteOrigin();
  if (key.length < 8 || !env.growth.landingUrl || !origin.startsWith('https://')) return;
  const st = siteState();
  const urls = SITE_PAGES.filter((p) => st.pages[p.path]).map((p) => pageUrl(p.path));
  const signature = SITE_PAGES.map((p) => `${p.path}=${st.pages[p.path]?.hash ?? ''}`).join('|');
  if (!urls.length || st.indexNow === signature) return;
  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: new URL(origin).host, key, keyLocation: `${origin}/${key}.txt`, urlList: urls }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok || res.status === 202) {
      st.indexNow = signature;
      saveState(st);
      console.log(`[SEO] IndexNow: ${urls.length} pages submitted to search engines.`);
    } else {
      console.warn(`[SEO] IndexNow answered ${res.status} - retrying on next boot.`);
    }
  } catch (err) {
    console.warn('[SEO] IndexNow unavailable:', (err as Error).message);
  }
}

// ---------- routes ----------

export function registerSiteRoutes(app: Express): void {
  // Old /conoce URLs: one canonical address per page once the site has its own domain.
  app.get([LANDING_PATH, `${LANDING_PATH}/*rest`], (req: Request, res: Response, next: NextFunction) => {
    if (!env.growth.landingUrl) return next();
    const rest = req.path.slice(LANDING_PATH.length).replace(/\/$/, '') || '/';
    res.redirect(301, pageUrl(SITE_PAGES.some((p) => p.path === rest) ? rest : '/'));
  });

  for (const page of SITE_PAGES) {
    if (page.path === '/') {
      // The home at "/" on its own host (other hosts keep the portal there), and at /conoce.
      app.get('/', (req, res, next) => (isLandingHost(req) ? sendPage(res, page) : next()));
      app.get([LANDING_PATH, `${LANDING_PATH}/`], (_req, res) => sendPage(res, page));
      continue;
    }
    app.get([page.path, `${LANDING_PATH}${page.path}`], (req, res) => {
      if (req.path.endsWith('/')) return res.redirect(301, pageUrl(page.path));
      sendPage(res, page);
    });
  }

  app.get('/robots.txt', (req, res) => {
    const sitemap = `${siteOrigin()}/sitemap.xml`;
    res.type('text/plain').send(
      isLandingHost(req)
        ? // /app is NOT disallowed on purpose: crawlers must fetch it to see its noindex header.
          `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${sitemap}\n`
        : // any other host: only the public pages are indexable, the private portal is not
          `User-agent: *\nAllow: ${LANDING_PATH}\nDisallow: /\n\nSitemap: ${sitemap}\n`,
    );
  });

  app.get('/sitemap.xml', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('application/xml').send(sitemapXml());
  });

  app.get('/llms.txt', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('text/plain').send(llmsTxt());
  });

  const key = env.growth.indexNowKey;
  if (key.length >= 8) {
    app.get(`/${key}.txt`, (_req, res) => void res.type('text/plain').send(key));
    setTimeout(() => void pingIndexNow(), 20_000).unref();
  }

  // Private areas never show up in search results (headers, so it works for any file type).
  app.use([PORTAL_PATH, '/api'], (_req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });
}

const NOT_FOUND_HTML = `<!doctype html>
<html lang="es"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Página no encontrada | Canix</title><meta name="robots" content="noindex" />
<link rel="icon" href="/favicon.ico" sizes="48x48" /><link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<style>
:root{--bg:#fff;--ink:#141a45;--muted:#5b6185;--brand:#4b5cf6}
@media (prefers-color-scheme:dark){:root{--bg:#0b0e24;--ink:#fff;--muted:#b6bbdc}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px}
img{width:140px;height:140px}h1{font-size:28px;margin:12px 0 4px}p{color:var(--muted);margin:0 0 24px}
a{display:inline-block;margin:4px;padding:12px 20px;border-radius:14px;background:var(--brand);color:#fff;font-weight:700;text-decoration:none}
a.alt{background:transparent;color:var(--brand);border:1px solid currentColor}
</style></head>
<body><main><img src="/stickers/revisando.webp" alt="" /><h1>No encontramos esta página</h1>
<p>Puede que el enlace esté mal escrito o que la página ya no exista.</p>
<a href="/">Ir al inicio</a><a class="alt" href="/#demo">Probar Canix gratis</a></main></body></html>`;

/** Branded 404 for unknown pages - registered last, after every route and the static files. */
export function registerNotFound(app: Express): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || !req.accepts('html')) return next();
    res.status(404).type('html').send(NOT_FOUND_HTML);
  });
}
