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
  app.post(`${base}/group`, h((req, res) => res.json({ items: studio.createGroup(userId(req), str(req.body?.title, 60) ?? '') })));
  app.post(`${base}/:id/preview`, h((req, res) => res.json({ items: studio.preview(id(req)) })));
  app.get(`${base}/:id/preview`, h((req, res) => void res.sendFile(studio.previewFile(id(req)))));
  app.post(`${base}/:id/approve`, h((req, res) => res.json({ items: studio.approve(id(req)) })));
  app.post(`${base}/:id/discard`, h((req, res) => res.json({ items: studio.discard(id(req)) })));
}
