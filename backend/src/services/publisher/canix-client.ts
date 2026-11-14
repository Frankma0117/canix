import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PublisherHost } from './automation/automation.host.js';

/**
 * For the administrator's OTHER projects (Brindix, a landing...): they have no WhatsApp of their
 * own, so the publisher talks to the administrator through Canix's notifier API.
 *   · createCanixHost()    → the PublisherHost to pass to setPublisherHost(): notices and approval requests
 *                            go to Canix (POST /api/v1/messages and /api/v1/approvals).
 *   · verifyCanixWebhook() → what the project's webhook route runs to trust Canix's answer, before calling
 *                            handleApprovalDecision(ref, status).
 * .env of the project: CANIX_URL, CANIX_API_KEY, CANIX_WEBHOOK_SECRET (shown once in Canix → Proyectos conectados).
 * Does not depend on anything else of the project. See docs/NOTIFY-API.md.
 */
export function createCanixHost(o: { url: string; apiKey: string; adminId: () => number | null }): PublisherHost {
  const base = o.url.replace(/\/$/, '');
  async function post(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${o.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(`Canix: ${data.error ?? `HTTP ${res.status}`}`);
    return data;
  }
  return {
    adminId: o.adminId,
    async notify(text) {
      await post('/api/v1/messages', { text });
      return null; // reactions are not used here: approvals go through requestApproval
    },
    async requestApproval(a) {
      await post('/api/v1/approvals', { title: a.title, text: a.text, imageUrl: a.imageUrl, ref: a.ref, expiresInMinutes: a.expiresInMinutes });
    },
  };
}

/** True when the request really comes from Canix (HMAC of `timestamp.body` with the project's secret) and is recent. */
export function verifyCanixWebhook(secret: string, headers: Record<string, string | string[] | undefined>, rawBody: string, toleranceSec = 300): boolean {
  const ts = String(headers['x-canix-timestamp'] ?? '');
  const sig = String(headers['x-canix-signature'] ?? '');
  if (!/^\d{9,12}$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > toleranceSec) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex')}`;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
