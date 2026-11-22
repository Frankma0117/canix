import express, { type Express } from 'express';
import { createPromo, deletePromo, listPromo, promoStatus, redrawImage, redrawVideo, reviewPromo, saveSettings, updatePromoTexts, resumePromoQueue } from '../../services/promo/promo.service.js';
import { LOCAL_DIR } from '../../services/promo/promo-storage.js';
import { h, int, str, strArr, userId } from '../http-helpers.js';

/**
 * Advertising material (/api/admin/promo/*, admin only - mounted behind requirePanelAdmin by
 * admin.routes.ts): videos and images of Canix to post on social media, reviewed before use.
 */
export function registerPromoRoutes(app: Express): void {
  // Files kept on disk when Spaces isn't configured (public on purpose: it's advertising).
  app.use('/promo-files', express.static(LOCAL_DIR, { maxAge: '7d', index: false, dotfiles: 'deny' }));
  resumePromoQueue();

  app.get('/api/admin/promo', h(async (_req, res) => res.json({ items: listPromo(), status: await promoStatus() })));

  app.post(
    '/api/admin/promo',
    h((req, res) => {
      const media = req.body?.media === 'image' ? 'image' : 'video';
      res.json({
        items: createPromo(userId(req), {
          media,
          kind: str(req.body?.kind, 20) ?? '',
          feature: str(req.body?.feature, 40) ?? null,
          formats: strArr(req.body?.formats),
          layout: str(req.body?.layout, 20),
          count: int(req.body?.count),
          idea: str(req.body?.idea, 500),
        }),
      });
    }),
  );

  app.put(
    '/api/admin/promo/settings',
    h(async (req, res) => {
      saveSettings({ voice: str(req.body?.voice, 10), music: str(req.body?.music, 20) });
      res.json(await promoStatus());
    }),
  );

  app.post('/api/admin/promo/:id/review', h((req, res) => res.json(reviewPromo(Number(req.params.id), req.body?.approve === true))));

  app.put(
    '/api/admin/promo/:id',
    h((req, res) => res.json(updatePromoTexts(Number(req.params.id), str(req.body?.title, 90) ?? '', str(req.body?.caption, 400) ?? ''))),
  );

  app.post(
    '/api/admin/promo/:id/redraw',
    h((req, res) =>
      res.json(
        redrawImage(Number(req.params.id), {
          headline: str(req.body?.headline, 60),
          sub: str(req.body?.sub, 160),
          cta: str(req.body?.cta, 32),
          bullets: Array.isArray(req.body?.bullets) ? strArr(req.body.bullets) : undefined,
        }),
      ),
    ),
  );

  app.post(
    '/api/admin/promo/:id/revise',
    h((req, res) => {
      const scenes = Array.isArray(req.body?.scenes)
        ? (req.body.scenes as Record<string, unknown>[]).map((s) => ({ text: str(s?.text, 80), say: str(s?.say, 400), items: Array.isArray(s?.items) ? strArr(s.items) : undefined }))
        : undefined;
      res.json(redrawVideo(Number(req.params.id), { scenes, instruction: str(req.body?.instruction, 600), voice: str(req.body?.voice, 10) }));
    }),
  );

  app.delete(
    '/api/admin/promo/:id',
    h(async (req, res) => {
      await deletePromo(Number(req.params.id));
      res.json({ ok: true });
    }),
  );
}
