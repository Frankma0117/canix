import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from '../middleware/security.middleware.js';
import { answerByLink, authenticate, createApproval, createClient, deleteClient, getApproval, pageFor, recentMessages, rotateKey, rotateSecret, sendMessage, updateClient, clientView, type PageState } from '../../services/notify/notify.service.js';
import { notifyStore } from '../../services/notify/notify.store.js';
import { h, str } from '../http-helpers.js';

const esc = (s: string | undefined) => (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

declare module 'express-serve-static-core' {
  interface Request {
    notifyClient?: ReturnType<typeof authenticate>;
  }
}

/** The page the confirmation link opens: one decision, big buttons, works on any phone. */
function page(token: string, p: PageState): string {
  const done = { approved: ['✅', 'Aprobado', 'Ya quedó aprobado. Puedes cerrar esta página.'], rejected: ['❌', 'Rechazado', 'Ya quedó rechazado. Puedes cerrar esta página.'], expired: ['⏰', 'Venció', 'Este enlace ya venció.'], missing: ['🤔', 'No encontrado', 'Este enlace no existe o ya no sirve.'] } as const;
  const body =
    p.state === 'pending'
      ? `<p class="from">${esc(p.client)} pide tu aprobación</p><h1>${esc(p.title)}</h1>${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="">` : ''}${p.body ? `<p class="body">${esc(p.body)}</p>` : ''}
         <form method="post" action="/a/${token}"><button name="decision" value="approve" class="yes">👍 Aprobar</button><button name="decision" value="reject" class="no">👎 Rechazar</button></form>`
      : `<div class="big">${done[p.state][0]}</div><h1>${done[p.state][1]}</h1>${p.title ? `<p class="body"><strong>${esc(p.title)}</strong></p>` : ''}<p class="body">${done[p.state][2]}</p>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Confirmar · Canix</title>
<style>*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f4f5ff;color:#12163a;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
main{width:100%;max-width:460px;background:#fff;border-radius:24px;padding:28px 22px;box-shadow:0 20px 50px -20px rgba(75,92,246,.35);text-align:center}
.from{margin:0 0 6px;color:#5b6090;font-size:14px}h1{margin:0 0 14px;font-size:24px;line-height:1.2}img{width:100%;max-height:340px;object-fit:contain;border-radius:16px;background:#eef0ff;margin:0 0 14px}
.body{margin:0 0 18px;color:#3a3f6b;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}.big{font-size:56px;margin-bottom:6px}
form{display:grid;gap:10px}button{font:inherit;font-weight:700;font-size:18px;border:0;border-radius:16px;padding:16px;cursor:pointer}.yes{background:#4b5cf6;color:#fff}.no{background:#eef0ff;color:#12163a}
@media (prefers-color-scheme:dark){body{background:#0e1130;color:#fff}main{background:#1a1f45}.from,.body{color:#c4c8f0}.no{background:#2a3066;color:#fff}img{background:#12163a}}</style></head><body><main>${body}</main></body></html>`;
}

/**
 * Public side of the notifier: the API the projects call (Bearer key) and the confirmation page.
 * Registered BEFORE the portal's authentication in server.ts. See docs/NOTIFY-API.md.
 */
export function registerNotifyPublicRoutes(app: Express): void {
  const byKey = (req: Request) => (req.header('authorization') ?? req.ip ?? 'anon').slice(0, 40);
  const limit = rateLimit({ capacity: 30, windowMs: 60_000, keyFn: byKey, message: 'Demasiadas solicitudes. Espera un momento.' });
  const auth = (req: Request, res: Response, next: NextFunction) => {
    const client = authenticate(req.header('authorization'));
    if (!client) return void res.status(401).json({ error: 'Llave de API no válida.' });
    req.notifyClient = client;
    next();
  };

  app.post('/api/v1/messages', limit, auth, h(async (req, res) => res.status(201).json(await sendMessage(req.notifyClient!, { text: req.body?.text, title: req.body?.title, imageUrl: req.body?.imageUrl }))));
  app.post('/api/v1/approvals', limit, auth, h(async (req, res) => res.status(201).json(await createApproval(req.notifyClient!, req.body ?? {}))));
  app.get('/api/v1/approvals/:id', limit, auth, h((req, res) => res.json(getApproval(req.notifyClient!, Number(req.params.id)))));

  // The confirmation link. Never indexed, never cached, no referrer.
  const noStore = (res: Response) => res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
  const linkLimit = rateLimit({ capacity: 30, windowMs: 10 * 60_000, message: 'Demasiados intentos. Espera unos minutos.' });
  app.get('/a/:token', linkLimit, (req, res) => {
    noStore(res).type('html').send(page(String(req.params.token), pageFor(String(req.params.token))));
  });
  app.post('/a/:token', linkLimit, express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
    const token = String(req.params.token);
    noStore(res).type('html').send(page(token, answerByLink(token, req.body?.decision === 'approve')));
  });
}

/** Admin side (/api/admin/notify/*, behind requirePanelAdmin): the connected projects and their log. */
export function registerNotifyAdminRoutes(app: Express): void {
  app.get('/api/admin/notify', h((_req, res) => res.json({ clients: notifyStore.listClients().map(clientView), messages: recentMessages() })));
  app.post('/api/admin/notify/clients', h((req, res) => res.json(createClient(str(req.body?.name, 40) ?? '', str(req.body?.webhookUrl, 300)))));
  app.put('/api/admin/notify/clients/:id', h((req, res) => res.json(updateClient(Number(req.params.id), { webhookUrl: str(req.body?.webhookUrl, 300), enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined }))));
  app.post('/api/admin/notify/clients/:id/rotate-key', h((req, res) => res.json(rotateKey(Number(req.params.id)))));
  app.post('/api/admin/notify/clients/:id/rotate-secret', h((req, res) => res.json(rotateSecret(Number(req.params.id)))));
  app.delete('/api/admin/notify/clients/:id', h((req, res) => (deleteClient(Number(req.params.id)), res.json({ ok: true }))));
}
