import { randomInt } from 'node:crypto';
import { db } from '../db/pool.js';
import { usersRepo } from '../db/repositories/users.repo.js';
import { permissionsRepo } from '../db/repositories/permissions.repo.js';
import { issueTemporaryPassword, revokeAllSessions } from '../auth/web-auth.js';
import { portalAccessMessage } from '../agent/tools/set-web-password.tool.js';
import { ensureWeeklyReportReminder } from '../agent/weekly-report.js';
import { ensureDailyResetReminder } from '../agent/daily-reset.js';
import { ensureDailyDedupReminder } from '../agent/dedup.js';
import { checkBudget, recordSend } from '../whatsapp/send-guard.js';
import { env } from '../config/env.js';
import { recordServerEvent } from './analytics.js';
import type { User } from '../types/index.js';

/**
 * Free trial accounts, end to end:
 *   1. the landing page asks for a name -> requestDemo() returns a one-time code (DEMO-XXXXX);
 *   2. the visitor sends that code to the bot from THEIR WhatsApp (a wa.me link pre-fills it) ->
 *      bot-manager.ts calls activateDemo(): the number is proven theirs and the bot only ever
 *      REPLIES (never cold-messages a stranger, the riskiest pattern for the bot's number);
 *   3. the account gets the 'demo' package for DEMO_HOURS, then expireDemos() turns it off (data is
 *      kept, so converting them into a customer later loses nothing).
 */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I - easy to read aloud
const CODE_RE = /\bDEMO[-\s]?([A-HJ-NP-Z2-9]{5})\b/i;
const PENDING_TTL_HOURS = 48;

export class DemoError extends Error {}

function newCode(): string {
  let c = '';
  for (let i = 0; i < 5; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `DEMO-${c}`;
}

function activeDemoCount(): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE demo_status = 'active'`).get() as { n: number }).n;
}

/** 'YYYY-MM-DD HH:MM:SS' (UTC, SQLite's datetime('now') format) N hours from now. */
function utcPlusHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
}

/** "jueves 9 de octubre, 6:30 p. m." in the bot's timezone, from a UTC 'YYYY-MM-DD HH:MM:SS'. */
export function formatUtcLocal(utc: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: env.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(utc.replace(' ', 'T') + 'Z'));
}

export function requestDemo(input: { name: string; interest?: string | null; visitor?: string | null }): { code: string } {
  const name = input.name.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (name.length < 2) throw new DemoError('Cuéntanos tu nombre para crear la demo.');
  if (activeDemoCount() >= env.growth.maxActiveDemos) {
    throw new DemoError('En este momento hay muchas demos activas. Escríbenos por WhatsApp y te activamos una enseguida.');
  }
  let code = newCode();
  while (db.prepare('SELECT 1 FROM demo_requests WHERE code = ?').get(code)) code = newCode();
  db.prepare('INSERT INTO demo_requests (code, name, interest, visitor) VALUES (?, ?, ?, ?)').run(
    code,
    name,
    input.interest?.trim().slice(0, 200) || null,
    input.visitor ?? null,
  );
  return { code };
}

/** The demo code inside an incoming WhatsApp text, normalized ("demo 7k3pq" -> "DEMO-7K3PQ"). */
export function extractDemoCode(text: string): string | null {
  const m = CODE_RE.exec(text);
  return m ? `DEMO-${m[1].toUpperCase()}` : null;
}

interface Sender {
  sendText(jid: string, text: string): Promise<void>;
}

/**
 * Turns a pending code into a live demo account for the WhatsApp number that sent it. Returns false
 * when the code doesn't exist / was used / expired (the caller then answers like to any stranger).
 */
export async function activateDemo(input: { code: string; phoneJid: string; lid: string | null; pushName?: string; wa: Sender }): Promise<boolean> {
  const req = db
    .prepare(`SELECT * FROM demo_requests WHERE code = ? AND status = 'pending' AND created_at >= datetime('now', ?)`)
    .get(input.code, `-${PENDING_TTL_HOURS} hours`) as { id: number; name: string } | undefined;
  if (!req) return false;

  const pkg = permissionsRepo.getPackage('demo');
  if (!pkg) throw new Error('No existe el paquete "demo" (permissions catalog).');

  const expiresAt = utcPlusHours(env.growth.demoHours);
  const user = db.transaction(() => {
    const u = usersRepo.create({ jid: input.phoneJid, name: req.name || input.pushName || null, role: 'user' });
    if (input.lid && !u.lid) usersRepo.setLid(u.jid, input.lid);
    permissionsRepo.setUserAccess(null, u.id, { packageIds: [pkg.id], allow: [], deny: [] });
    db.prepare(`UPDATE users SET demo_expires_at = ?, demo_status = 'active' WHERE id = ?`).run(expiresAt, u.id);
    db.prepare(`UPDATE demo_requests SET status = 'activated', user_id = ?, activated_at = datetime('now') WHERE id = ?`).run(u.id, req.id);
    permissionsRepo.recordAudit(null, u.id, 'demo.activated', { code: input.code, expires_at: expiresAt });
    return usersRepo.getById(u.id)!;
  })();

  ensureWeeklyReportReminder(user.id, user.jid);
  ensureDailyResetReminder(user.id, user.jid);
  ensureDailyDedupReminder(user.id, user.jid);
  recordServerEvent('demo_activated', input.code);
  console.log('[DEMO] Demo %s activada para #%d (%s) hasta %s UTC.', input.code, user.id, user.jid, expiresAt);

  const first = (user.name ?? '').split(' ')[0];
  await input.wa.sendText(
    user.jid,
    `🎉 ¡Hola${first ? ` ${first}` : ''}! Soy *Canix*, tu asistente personal. Tu demo gratis ya está activa hasta el ` +
      `*${formatUtcLocal(expiresAt)}*.\n\n` +
      'Pruébame escribiéndome (o mandándome un audio) cosas como:\n' +
      '• "Recuérdame tomar agua en 20 minutos"\n' +
      '• "Crea la rutina de leer a las 9pm"\n' +
      '• "Agrega pan y huevos a la lista del mercado"\n' +
      '• "Guárdame una nota: la clave del wifi es…"\n' +
      '• "¿Qué tengo hoy?"\n\n' +
      'Escribe /menu para ver todo lo que puedo hacer.',
  );
  const pwd = await issueTemporaryPassword(user.id, null);
  await input.wa.sendText(user.jid, portalAccessMessage(user.jid, pwd));
  await input.wa.sendText(user.jid, '👤 Una última cosa: ¿eres hombre o mujer? Así te hablo en el género correcto (respóndeme solo "hombre" o "mujer").');
  return true;
}

function contactLink(text: string): string {
  return `https://wa.me/${env.growth.contactWhatsapp}?text=${encodeURIComponent(text)}`;
}

export function demoEndedMessage(user: Pick<User, 'name'>): string {
  return (
    `⏰ Tu demo de Canix terminó${user.name ? `, ${user.name.split(' ')[0]}` : ''}. ¡Gracias por probarme! 🙌\n\n` +
    'Tu información quedó guardada: si activas tu cuenta, sigues justo donde quedaste. Escríbenos aquí para activarla:\n' +
    contactLink('Hola, probé la demo de Canix y quiero activar mi cuenta.')
  );
}

export function isDemoExpired(user: Pick<User, 'demo_status'>): boolean {
  return user.demo_status === 'expired';
}

/** Ends every demo whose time is up: access off, portal sessions closed, one goodbye message. */
export async function expireDemos(wa: Sender): Promise<number> {
  const due = db
    .prepare(`SELECT * FROM users WHERE demo_status = 'active' AND demo_expires_at IS NOT NULL AND demo_expires_at <= datetime('now')`)
    .all() as User[];
  for (const u of due) {
    db.prepare(`UPDATE users SET demo_status = 'expired' WHERE id = ?`).run(u.id);
    revokeAllSessions(u.id);
    permissionsRepo.recordAudit(null, u.id, 'demo.expired');
    console.log('[DEMO] Demo de #%d (%s) terminó.', u.id, u.jid);
    const budget = checkBudget('proactive', env.wa.session);
    if (!budget.ok) continue;
    try {
      await wa.sendText(u.jid, demoEndedMessage(u));
      recordSend('proactive', u.jid);
    } catch (err) {
      console.error('[DEMO] No pude avisar el fin de la demo a %s:', u.jid, (err as Error).message);
    }
  }
  return due.length;
}

/** Admin: give a demo more time (also revives an expired one). */
export function extendDemo(actorId: number, userId: number, hours: number): User {
  const u = usersRepo.getById(userId);
  if (!u || !u.demo_status) throw new DemoError('Esa persona no tiene una cuenta demo.');
  const h = Math.min(Math.max(Math.round(hours), 1), 24 * 30);
  const base = u.demo_status === 'active' && u.demo_expires_at && u.demo_expires_at > utcPlusHours(0) ? u.demo_expires_at : utcPlusHours(0);
  const until = new Date(new Date(base.replace(' ', 'T') + 'Z').getTime() + h * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(`UPDATE users SET demo_expires_at = ?, demo_status = 'active' WHERE id = ?`).run(until, u.id);
  permissionsRepo.recordAudit(actorId, u.id, 'demo.extended', { hours: h, until });
  return usersRepo.getById(u.id)!;
}

/** Admin: the demo becomes a real account (keeps its current permissions - adjust them after). */
export function convertDemo(actorId: number, userId: number): User {
  const u = usersRepo.getById(userId);
  if (!u || !u.demo_status) throw new DemoError('Esa persona no tiene una cuenta demo.');
  db.prepare('UPDATE users SET demo_expires_at = NULL, demo_status = NULL WHERE id = ?').run(u.id);
  permissionsRepo.recordAudit(actorId, u.id, 'demo.converted');
  recordServerEvent('demo_converted', String(u.id));
  return usersRepo.getById(u.id)!;
}
