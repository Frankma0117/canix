import type { Express, Request } from 'express';
import { h, int, str, userId } from '../http-helpers.js';
import * as studio from '../../services/video-studio/video-studio.service.js';
import { canixTemplate } from '../../services/video-studio/spec.js';

/** Video studio (/api/admin/video-studio/*, admin only - mounted behind requirePanelAdmin). */
export function registerVideoStudioRoutes(app: Express): void {
  const base = '/api/admin/video-studio';
  studio.recoverInterrupted();
  const id = (req: Request) => int(req.params.id) ?? 0;

  app.get(base, h((_req, res) => res.json({ items: studio.list(), available: studio.available(), template: canixTemplate(), assets: studio.assets() })));
  app.get(`${base}/asset/*rel`, h((req, res) => void res.sendFile(studio.assetFile([(req.params as Record<string, string | string[]>).rel ?? ''].flat().join('/')))));
  app.post(base, h((req, res) => res.json({ items: studio.create(userId(req), str(req.body?.title, 90) ?? '', req.body?.spec) })));
  app.put(`${base}/:id`, h((req, res) => res.json({ items: studio.update(id(req), str(req.body?.title, 90) ?? '', req.body?.spec) })));
  app.delete(
    `${base}/:id`,
    h(async (req, res) => {
      await studio.remove(id(req));
      res.json({ ok: true });
    }),
  );
  app.post(`${base}/:id/render`, h((req, res) => res.json({ items: studio.render(id(req)) })));
  app.post(`${base}/:id/review`, h(async (req, res) => res.json({ items: await studio.review(id(req), req.body?.approve === true) })));
  app.get(`${base}/:id/file`, h((req, res) => void res.sendFile(studio.reviewFile(id(req)))));
}
