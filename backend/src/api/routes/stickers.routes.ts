import type { Express } from 'express';
import multer from 'multer';
import { stickersModel, isWebp, normalizeStickerLabel } from '../../models/stickers.model.js';
import { STICKER_MOMENTS, cleanMoments, suggestMoments } from '../../services/stickers/sticker-moments.js';
import { momentsOf } from '../../services/stickers/stickers.service.js';
import { requirePanelAdmin } from '../middleware/auth.middleware.js';
import { rateLimit } from '../middleware/security.middleware.js';
import { h, str } from '../http-helpers.js';

/** WhatsApp's own limit for animated stickers is 500 KB; a little headroom for static ones saved from elsewhere. */
const MAX_STICKER_BYTES = 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_STICKER_BYTES, files: 30 } });

/** The sticker pack (administrator only): see it, say when each one fits, upload, pause, delete. */
export function registerStickerRoutes(app: Express): void {
  app.use('/api/admin/stickers', requirePanelAdmin);

  app.get(
    '/api/admin/stickers',
    h((_req, res) => {
      const stickers = stickersModel.listMeta().map((s) => ({
        ...s,
        moments: momentsOf(s),
        momentsSuggested: !s.moments,
        suggestedMoments: suggestMoments(s.label),
      }));
      const coverage = Object.fromEntries(
        STICKER_MOMENTS.map((m) => [m.key, stickers.filter((s) => s.active && s.label && s.moments.includes(m.key)).length]),
      );
      res.json({ moments: STICKER_MOMENTS.map(({ key, label, when }) => ({ key, label, when })), stickers, coverage });
    }),
  );

  app.get(
    '/api/admin/stickers/:id/image',
    h((req, res) => {
      const sticker = stickersModel.getById(Number(req.params.id));
      if (!sticker) return void res.status(404).json({ error: 'No existe ese sticker.' });
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.type('image/webp').send(sticker.data);
    }),
  );

  app.post(
    '/api/admin/stickers',
    rateLimit({ capacity: 10, windowMs: 60_000, keyFn: (req) => `stickers:${req.panelUser?.id}` }),
    upload.array('files', 30),
    h((req, res) => {
      const files = (req.files ?? []) as Express.Multer.File[];
      if (files.length === 0) return void res.status(400).json({ error: 'Adjunta al menos un sticker .webp.' });
      const created: number[] = [];
      const skipped: string[] = [];
      for (const file of files) {
        if (!isWebp(file.buffer)) {
          skipped.push(`${file.originalname} (no es WebP)`);
          continue;
        }
        if (stickersModel.findByData(file.buffer)) {
          skipped.push(`${file.originalname} (ya estaba)`);
          continue;
        }
        const label = normalizeStickerLabel(file.originalname.replace(/\.webp$/i, '')) || 'sticker';
        created.push(stickersModel.createLabeled(req.panelUser!.id, file.buffer, label));
      }
      res.status(created.length ? 201 : 400).json({ created, skipped, ...(created.length ? {} : { error: 'Ningún archivo se pudo agregar.' }) });
    }),
  );

  app.patch(
    '/api/admin/stickers/:id',
    h((req, res) => {
      const id = Number(req.params.id);
      if (!stickersModel.getById(id)) return void res.status(404).json({ error: 'No existe ese sticker.' });
      const label = req.body?.label === undefined ? undefined : normalizeStickerLabel(String(req.body.label));
      if (label === '') return void res.status(400).json({ error: 'El nombre no puede quedar vacío.' });
      stickersModel.update(id, {
        label,
        moments: req.body?.moments === undefined ? undefined : req.body.moments === null ? null : cleanMoments(req.body.moments),
        usage: req.body?.usage === undefined ? undefined : (str(req.body.usage, 300) ?? null) || null,
        active: typeof req.body?.active === 'boolean' ? req.body.active : undefined,
      });
      res.json({ ok: true });
    }),
  );

  app.delete(
    '/api/admin/stickers/:id',
    h((req, res) => {
      stickersModel.delete(Number(req.params.id));
      res.json({ ok: true });
    }),
  );
}
