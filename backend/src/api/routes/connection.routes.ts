import { type Express } from 'express';
import qrcode from 'qrcode';
import type { BotManager } from '../../channels/whatsapp/bot-manager.js';
import { requirePanelAdmin } from '../middleware/auth.middleware.js';
import { h } from '../http-helpers.js';

/** The single shared WhatsApp session: status, QR, reconnect, switch number (admin only). */
export function registerConnectionRoutes(app: Express, bot: BotManager): void {
  app.use('/api/connection', requirePanelAdmin);
  app.get(
    '/api/connection/status',
    h((_req, res) => {
      const wa = bot.session;
      res.json({
        connection: wa.connectionState,
        connected: wa.isConnected(),
        hasQr: Boolean(wa.qr),
        banSuspected: wa.banSuspected,
        // Anti-ban daily send governor snapshot (see channels/whatsapp/send-guard.ts) - lets the admin panel
        // actually show the safety net is working instead of just trusting it's there.
        sendGuard: wa.sendGuardStats(),
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
  // Abandons the currently linked number and shows a new QR to link a different one.
  // Deliberate admin action only - never triggered automatically.
  app.post(
    '/api/connection/new-number',
    h(async (_req, res) => {
      await bot.session.useNewNumber();
      res.json({ ok: true });
    }),
  );
}
