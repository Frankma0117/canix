import { createHash, createHmac, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import { AccessError } from '../../models/permissions.model.js';
import { decryptSecret, encryptSecret } from '../publisher/publisher-crypto.js';
import { fromDb, notifyStore, toDb, type NotifyClient, type NotifyMessage } from './notify.store.js';

/**
 * Canix as the messenger of the administrator's other projects.
 *   · A project (Brindix, a landing...) has an API key and sends messages to the administrator's WhatsApp.
 *   · It can ask for an approval: the message arrives with an optional picture, 👍 / 👎 answer it, and so does
 *     a link («Confirmar aquí») that works from any phone. The decision comes back to the project as a
 *     signed webhook (HMAC-SHA256) - or the project can ask for it (GET /api/v1/approvals/:id).
 * The first answer wins; an unanswered approval expires (and the project is told that too).
 */
export interface NotifySender {
  /** Sends to the administrator's WhatsApp; returns the id of the sent message (to recognize a reaction to it). */
  send(text: string, imageUrl?: string): Promise<string | null>;
}
let sender: NotifySender = { send: async () => null };
export const setNotifySender = (s: NotifySender) => {
  sender = s;
};

const MAX_PENDING = 25;
const WEBHOOK_BACKOFF_MIN = [1, 2, 5, 15, 60, 180];

const hash = (key: string) => createHash('sha256').update(key).digest('hex');
const newKey = () => `cnx_${randomBytes(24).toString('base64url')}`;
const newSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;
export const baseUrl = () => (env.panelUrl || `http://localhost:${env.port}`).replace(/\/$/, '');

function cleanName(name: string): string {
  const n = name.trim().replace(/\s+/g, ' ');
  if (n.length < 2 || n.length > 40) throw new AccessError('El nombre debe tener entre 2 y 40 letras.');
  return n;
}

function cleanWebhook(url: string | undefined): string {
  const u = (url ?? '').trim();
  if (!u) return '';
  if (u.length > 300) throw new AccessError('La dirección del webhook es muy larga.');
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    throw new AccessError('La dirección del webhook no es válida.');
  }
  const local = ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) throw new AccessError('El webhook debe ser https.');
  return u;
}

// ---------- clients (admin) ----------

export function clientView(c: NotifyClient) {
  return { id: c.id, name: c.name, keyPrefix: c.key_prefix, webhookUrl: c.webhook_url, enabled: !!c.enabled, lastUsedAt: fromDb(c.last_used_at), pending: notifyStore.pendingCount(c.id), createdAt: fromDb(c.created_at) };
}

export function createClient(name: string, webhookUrl?: string) {
  const clean = cleanName(name);
  if (notifyStore.listClients().some((c) => c.name.toLowerCase() === clean.toLowerCase())) throw new AccessError('Ya hay un proyecto con ese nombre.');
  const apiKey = newKey();
  const secret = newSecret();
  const id = notifyStore.createClient({ name: clean, keyHash: hash(apiKey), keyPrefix: apiKey.slice(0, 10), webhookUrl: cleanWebhook(webhookUrl), webhookSecretEnc: encryptSecret(secret) });
  // The key and the secret are shown ONCE: only their hash / encrypted form is kept.
  return { client: clientView(notifyStore.getClient(id)!), apiKey, webhookSecret: secret };
}

function load(id: number): NotifyClient {
  const c = notifyStore.getClient(id);
  if (!c) throw new AccessError('Ese proyecto ya no existe.');
  return c;
}

export function updateClient(id: number, input: { webhookUrl?: string; enabled?: boolean }) {
  load(id);
  notifyStore.updateClient(id, { webhookUrl: input.webhookUrl === undefined ? undefined : cleanWebhook(input.webhookUrl), enabled: input.enabled });
  return clientView(load(id));
}

export function rotateKey(id: number) {
  load(id);
  const apiKey = newKey();
  notifyStore.rotateKey(id, hash(apiKey), apiKey.slice(0, 10));
  return { client: clientView(load(id)), apiKey };
}

export function rotateSecret(id: number) {
  load(id);
  const secret = newSecret();
  notifyStore.rotateSecret(id, encryptSecret(secret));
  return { webhookSecret: secret };
}

export function deleteClient(id: number) {
  load(id);
  notifyStore.deleteClient(id);
}

export const recentMessages = () =>
  notifyStore.recent().map((m) => ({
    id: m.id,
    client: m.client_name,
    kind: m.kind,
    title: m.title,
    body: m.body.slice(0, 140),
    status: m.status,
    decidedVia: m.decided_via,
    webhook: m.webhook_state,
    webhookError: m.webhook_error,
    error: m.error,
    createdAt: fromDb(m.created_at),
  }));

// ---------- the API used by the projects ----------

/** «Authorization: Bearer cnx_…» → the project, or null. */
export function authenticate(header: string | undefined): NotifyClient | null {
  const key = /^Bearer\s+(cnx_[A-Za-z0-9_-]{20,80})$/.exec(header ?? '')?.[1];
  if (!key) return null;
  const c = notifyStore.clientByKeyHash(hash(key));
  if (!c || !c.enabled) return null;
  notifyStore.touch(c.id);
  return c;
}

const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
function imageOf(v: unknown): string {
  const u = text(v, 500);
  if (!u) return '';
  if (!/^https:\/\/[^\s]+$/i.test(u)) throw new AccessError('La imagen debe ser una dirección https.');
  return u;
}

async function deliver(c: NotifyClient, id: number, message: string, imageUrl: string): Promise<string | null> {
  try {
    try {
      return await sender.send(message, imageUrl || undefined);
    } catch (err) {
      // A picture WhatsApp can't fetch shouldn't lose the message.
      if (!imageUrl) throw err;
      return await sender.send(`${message}\n\n🖼️ ${imageUrl}`);
    }
  } catch (err) {
    notifyStore.setFailed(id, (err as Error).message);
    console.log('[NOTIFY] %s: could not send #%d: %s', c.name, id, (err as Error).message);
    throw new AccessError('No se pudo enviar por WhatsApp. Inténtalo de nuevo.');
  }
}

export async function sendMessage(c: NotifyClient, input: { text?: unknown; title?: unknown; imageUrl?: unknown }) {
  const body = text(input.text, 1500);
  if (!body) throw new AccessError('Falta el texto del mensaje.');
  const title = text(input.title, 120);
  const imageUrl = imageOf(input.imageUrl);
  const id = notifyStore.createMessage({ clientId: c.id, kind: 'message', title, body, imageUrl, ref: '', status: 'sent' });
  const waId = await deliver(c, id, `🔔 *${c.name}*${title ? `\n*${title}*` : ''}\n${body}`, imageUrl);
  notifyStore.setSent(id, waId);
  return { id, status: 'sent' as const };
}

export async function createApproval(c: NotifyClient, input: { title?: unknown; text?: unknown; imageUrl?: unknown; ref?: unknown; expiresInMinutes?: unknown }) {
  const title = text(input.title, 120);
  if (!title) throw new AccessError('Falta el título de lo que se aprueba.');
  const body = text(input.text, 1500);
  const imageUrl = imageOf(input.imageUrl);
  const minutes = Math.max(5, Math.min(10_080, Math.trunc(Number(input.expiresInMinutes) || 1440)));
  if (notifyStore.pendingCount(c.id) >= MAX_PENDING) throw new AccessError('Hay demasiadas aprobaciones sin responder de este proyecto.');
  const token = randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + minutes * 60_000);
  const id = notifyStore.createMessage({ clientId: c.id, kind: 'approval', title, body, imageUrl, ref: text(input.ref, 200), status: 'pending', token, expiresAt: toDb(expiresAt) });
  const link = `${baseUrl()}/a/${token}`;
  const waId = await deliver(c, id, `🔔 *${c.name}* pide tu aprobación\n*${title}*${body ? `\n${body}` : ''}\n\n👍 aprobar · 👎 rechazar\nO confirma aquí: ${link}`, imageUrl);
  notifyStore.setSent(id, waId);
  return { id, status: 'pending' as const, link, expiresAt: expiresAt.toISOString() };
}

export function approvalView(m: NotifyMessage) {
  return { id: m.id, kind: m.kind, status: m.status, ref: m.ref, decidedVia: m.decided_via, decidedAt: fromDb(m.decided_at), expiresAt: fromDb(m.expires_at), createdAt: fromDb(m.created_at) };
}

export function getApproval(c: NotifyClient, id: number) {
  const m = notifyStore.getMessage(id);
  if (!m || m.client_id !== c.id || m.kind !== 'approval') throw new AccessError('Esa aprobación no existe.');
  return approvalView(m);
}

// ---------- answering ----------

const POSITIVE = ['👍', '✅', '👌', '🙌', '🔥', '❤'];
const NEGATIVE = ['👎', '❌', '🚫'];

/** First answer wins. Returns whether THIS call decided it. */
function decide(m: NotifyMessage, status: 'approved' | 'rejected' | 'expired', via: 'reaction' | 'link' | null): boolean {
  const c = notifyStore.getClient(m.client_id);
  const done = notifyStore.decide(m.id, status, via, !!c?.webhook_url);
  if (done) void sendWebhook(m.id);
  return done;
}

const verdict = (status: 'approved' | 'rejected') => (status === 'approved' ? 'Aprobaste' : 'Rechazaste');

/** The administrator reacted to a WhatsApp message: 👍 / 👎 on an approval request answers it. */
export async function handleNotifyReaction(targetId: string, emoji: string): Promise<{ handled: boolean; reply?: string }> {
  const m = notifyStore.byWaId(targetId);
  if (!m || m.kind !== 'approval') return { handled: false };
  const positive = POSITIVE.some((e) => emoji.startsWith(e));
  if (!positive && !NEGATIVE.some((e) => emoji.startsWith(e))) return { handled: true };
  const status = positive ? 'approved' : 'rejected';
  if (!decide(m, status, 'reaction')) return { handled: true };
  return { handled: true, reply: `${positive ? '✅' : '❌'} ${verdict(status)} «${m.title}».` };
}

export type PageState = { state: 'pending' | 'approved' | 'rejected' | 'expired' | 'missing'; title?: string; body?: string; imageUrl?: string; client?: string };

export function pageFor(token: string): PageState {
  const m = /^[a-f0-9]{48}$/.test(token) ? notifyStore.byToken(token) : undefined;
  if (!m) return { state: 'missing' };
  const c = notifyStore.getClient(m.client_id);
  const state = m.status === 'pending' && m.expires_at && m.expires_at <= toDb(new Date()) ? 'expired' : m.status;
  return { state: (['pending', 'approved', 'rejected', 'expired'].includes(state) ? state : 'missing') as PageState['state'], title: m.title, body: m.body, imageUrl: m.image_url, client: c?.name };
}

/** The confirmation link was used. Returns the page to show afterwards. */
export function answerByLink(token: string, approve: boolean): PageState {
  const m = /^[a-f0-9]{48}$/.test(token) ? notifyStore.byToken(token) : undefined;
  const before = pageFor(token);
  if (!m || before.state !== 'pending') return before;
  const status = approve ? 'approved' : 'rejected';
  if (decide(m, status, 'link')) void sender.send(`${approve ? '✅' : '❌'} ${verdict(status)} «${m.title}»${before.client ? ` de ${before.client}` : ''}.`).catch(() => {});
  return pageFor(token);
}

// ---------- webhook back to the project ----------

export const sign = (secret: string, timestamp: string, body: string) => `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

async function sendWebhook(id: number): Promise<void> {
  const m = notifyStore.getMessage(id);
  const c = m && notifyStore.getClient(m.client_id);
  if (!m || !c || m.webhook_state !== 'pending') return;
  if (!c.webhook_url) return void notifyStore.webhookResult(id, false, m.webhook_attempts, '', null, true);
  const body = JSON.stringify({ event: 'approval.decided', id: m.id, ref: m.ref, status: m.status, decidedVia: m.decided_via, decidedAt: fromDb(m.decided_at), project: c.name });
  const ts = String(Math.floor(Date.now() / 1000));
  const attempts = m.webhook_attempts + 1;
  try {
    const res = await fetch(c.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Canix-Event': 'approval.decided', 'X-Canix-Timestamp': ts, 'X-Canix-Signature': sign(decryptSecret(c.webhook_secret_enc), ts, body) },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    notifyStore.webhookResult(id, true, attempts, '', null, false);
  } catch (err) {
    const final = attempts >= WEBHOOK_BACKOFF_MIN.length;
    const next = toDb(new Date(Date.now() + WEBHOOK_BACKOFF_MIN[Math.min(attempts - 1, WEBHOOK_BACKOFF_MIN.length - 1)] * 60_000));
    notifyStore.webhookResult(id, false, attempts, (err as Error).message, final ? null : next, final);
    console.log('[NOTIFY] Webhook of #%d to %s failed (attempt %d): %s', id, c.name, attempts, (err as Error).message);
  }
}

let ticking = false;
/** Every minute: expire the approvals nobody answered and retry the webhooks that failed. */
export async function notifyTick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    for (const id of notifyStore.expiredIds(toDb(new Date()))) {
      const m = notifyStore.getMessage(id);
      if (m) decide(m, 'expired', null);
    }
    for (const m of notifyStore.webhooksDue(toDb(new Date()))) await sendWebhook(m.id);
  } finally {
    ticking = false;
  }
}

export function startNotifyJob(): void {
  setInterval(() => void notifyTick().catch((err) => console.error('[NOTIFY] Job error:', (err as Error).message)), 60_000).unref();
}
