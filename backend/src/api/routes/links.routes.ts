import { type Express } from 'express';
import { linksModel } from '../../models/links.model.js';
import { h, ownCategoryId, userId } from '../http-helpers.js';
import { normalizeHttpUrl } from '../../shared/utils/urls.js';

/** The link library. */
export function registerLinkRoutes(app: Express): void {
  app.get(
    '/api/links',
    h((req, res) => {
      const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
      res.json(linksModel.listByCategory(userId(req), categoryId));
    }),
  );
  app.post(
    '/api/links',
    h((req, res) => {
      const { url, category_id, title, description } = req.body ?? {};
      const safeUrl = normalizeHttpUrl(url);
      if (!safeUrl) return res.status(400).json({ error: 'El link debe ser una URL que empiece por http:// o https://' });
      const id = linksModel.create(userId(req), {
        url: safeUrl,
        categoryId: ownCategoryId(req, category_id) ?? null,
        title: title || null,
        description: description || null,
      });
      res.json({ id });
    }),
  );
  app.delete(
    '/api/links/:id',
    h((req, res) => {
      linksModel.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );
}
