import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { db } from '../db/pool.js';
import { permissionsRepo } from '../db/repositories/permissions.repo.js';
import { env } from '../config/env.js';

/**
 * First-party analytics for the public landing page: no third-party scripts, no cookies, no IPs
 * stored. A visitor is sha256(secret salt + day + IP + user-agent) - enough to count unique visits
 * per day, impossible to reverse into who they are, and it rotates daily by design.
 */

/** What the landing page may report (anything else is ignored). */
const CLIENT_EVENTS = new Set(['pageview', 'section', 'click', 'demo_start', 'faq']);

const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|python|headless|lighthouse|pingdom|uptime/i;

let salt: string | null = null;
function secretSalt(): string {
  if (salt) return salt;
  salt = permissionsRepo.getMeta('analytics_salt') ?? null;
  if (!salt) {
    salt = randomBytes(24).toString('hex');
    permissionsRepo.setMeta('analytics_salt', salt);
  }
  return salt;
}

export function visitorId(req: Request): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHash('sha256')
    .update(`${secretSalt()}|${day}|${req.ip ?? ''}|${req.get('user-agent') ?? ''}`)
    .digest('hex')
    .slice(0, 20);
}

function deviceOf(ua: string): string {
  if (/ipad|tablet/i.test(ua)) return 'tablet';
  if (/mobi|android|iphone/i.test(ua)) return 'móvil';
  return 'computador';
}

function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s || null;
}

/** Only the referring site's host, and never our own hosts (internal navigation isn't a source). */
function referrerHost(raw: unknown, req: Request): string | null {
  const s = clean(raw, 500);
  if (!s) return null;
  try {
    const host = new URL(s).hostname.replace(/^www\./, '');
    const own = new Set([req.hostname, env.growth.landingUrl ? new URL(env.growth.landingUrl).hostname : '', env.panelUrl ? new URL(env.panelUrl).hostname : '']);
    return own.has(host) ? null : host;
  } catch {
    return null;
  }
}

/** POST /api/public/track body -> one row (silently drops bots and unknown event types). */
export function recordClientEvent(req: Request, body: Record<string, unknown>): void {
  const ua = req.get('user-agent') ?? '';
  if (!ua || BOT_RE.test(ua)) return;
  const type = clean(body.type, 30);
  if (!type || !CLIENT_EVENTS.has(type)) return;
  db.prepare(
    `INSERT INTO web_events (type, path, label, referrer, utm_source, utm_medium, utm_campaign, device, visitor, session)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    type,
    clean(body.path, 200),
    clean(body.label, 80),
    type === 'pageview' ? referrerHost(body.referrer, req) : null,
    clean(body.utm_source, 60),
    clean(body.utm_medium, 60),
    clean(body.utm_campaign, 80),
    deviceOf(ua),
    visitorId(req),
    clean(body.session, 40),
  );
}

/** Events that happen on the server (demo requested/activated/converted). */
export function recordServerEvent(type: string, label: string | null, visitor: string | null = null): void {
  try {
    db.prepare('INSERT INTO web_events (type, label, visitor) VALUES (?, ?, ?)').run(type, label, visitor);
  } catch (err) {
    console.error('[ANALYTICS] No pude registrar %s:', type, (err as Error).message);
  }
}

/** Offset of the bot's timezone vs UTC, as an SQLite modifier ("-5 hours") - days are local days. */
function tzModifier(): string {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: env.timezone }));
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const minutes = Math.round((local.getTime() - utc.getTime()) / 60_000);
  return `${minutes >= 0 ? '+' : ''}${minutes} minutes`;
}

type Row = Record<string, string | number | null>;

export function analyticsReport(days: number) {
  const since = `-${days} days`;
  const tz = tzModifier();
  const one = <T extends Row>(sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as T;
  const all = <T extends Row>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[];
  const where = `ts >= datetime('now', ?)`;

  const totals = one<{ pageviews: number; visitors: number }>(
    `SELECT COUNT(*) AS pageviews, COUNT(DISTINCT visitor) AS visitors FROM web_events WHERE type = 'pageview' AND ${where}`,
    since,
  );
  const count = (type: string, label?: string) =>
    one<{ n: number }>(`SELECT COUNT(*) AS n FROM web_events WHERE type = ? ${label ? 'AND label LIKE ?' : ''} AND ${where}`, ...(label ? [type, label, since] : [type, since])).n;

  const daily = all<{ day: string; pageviews: number; visitors: number; demos: number }>(
    `SELECT date(ts, '${tz}') AS day,
            SUM(type = 'pageview') AS pageviews,
            COUNT(DISTINCT CASE WHEN type = 'pageview' THEN visitor END) AS visitors,
            SUM(type = 'demo_request') AS demos
     FROM web_events WHERE ${where} GROUP BY day ORDER BY day`,
    since,
  );

  const sawDemo = one<{ n: number }>(
    `SELECT COUNT(DISTINCT visitor) AS n FROM web_events WHERE type = 'section' AND label = 'demo' AND ${where}`,
    since,
  ).n;

  return {
    days,
    totals: {
      pageviews: totals.pageviews,
      visitors: totals.visitors,
      demoRequests: count('demo_request'),
      demoActivated: count('demo_activated'),
      demoConverted: count('demo_converted'),
      contactClicks: count('click', 'contact%'),
      demoWhatsappClicks: count('click', 'demo_whatsapp%'),
    },
    funnel: [
      { step: 'Visitantes', value: totals.visitors },
      { step: 'Vieron la sección demo', value: sawDemo },
      { step: 'Pidieron demo', value: count('demo_request') },
      { step: 'Activaron demo', value: count('demo_activated') },
      { step: 'Se volvieron clientes', value: count('demo_converted') },
    ],
    daily,
    referrers: all<{ name: string; n: number }>(
      `SELECT COALESCE(referrer, 'Directo / sin referencia') AS name, COUNT(*) AS n FROM web_events
       WHERE type = 'pageview' AND ${where} GROUP BY name ORDER BY n DESC LIMIT 10`,
      since,
    ),
    campaigns: all<{ name: string; n: number }>(
      `SELECT utm_source || COALESCE(' / ' || utm_medium, '') || COALESCE(' / ' || utm_campaign, '') AS name, COUNT(*) AS n
       FROM web_events WHERE type = 'pageview' AND utm_source IS NOT NULL AND ${where} GROUP BY name ORDER BY n DESC LIMIT 10`,
      since,
    ),
    devices: all<{ name: string; n: number }>(
      `SELECT COALESCE(device, 'otro') AS name, COUNT(DISTINCT visitor) AS n FROM web_events
       WHERE type = 'pageview' AND ${where} GROUP BY name ORDER BY n DESC`,
      since,
    ),
    sections: all<{ name: string; n: number }>(
      `SELECT label AS name, COUNT(DISTINCT visitor) AS n FROM web_events
       WHERE type = 'section' AND label IS NOT NULL AND ${where} GROUP BY label ORDER BY n DESC`,
      since,
    ),
    clicks: all<{ name: string; n: number }>(
      `SELECT label AS name, COUNT(*) AS n FROM web_events
       WHERE type = 'click' AND label IS NOT NULL AND ${where} GROUP BY label ORDER BY n DESC LIMIT 12`,
      since,
    ),
    demoRequests: all<{ code: string; name: string; interest: string | null; status: string; created_at: string; activated_at: string | null; user_id: number | null; demo_status: string | null; demo_expires_at: string | null }>(
      `SELECT d.code, d.name, d.interest, d.status, d.created_at, d.activated_at, d.user_id, u.demo_status, u.demo_expires_at
       FROM demo_requests d LEFT JOIN users u ON u.id = d.user_id
       WHERE d.created_at >= datetime('now', ?) ORDER BY d.id DESC LIMIT 50`,
      since,
    ),
  };
}
