import type { Express } from 'express';
import { checklistItemsModel, checklistsModel } from '../../models/checklists.model.js';
import { listMedia, relatedNotes, resolveMediaList, saveMedia } from '../../services/library/library.service.js';
import { MEDIA_KINDS, isMediaKind, listKindOf, normalizeListKind } from '../../shared/utils/list-kinds.js';
import { requirePermission } from '../middleware/auth.middleware.js';
import { h, userId, str, int } from '../http-helpers.js';
import { normalizeHttpUrl } from '../../shared/utils/urls.js';

/** A rating 1-5, null to clear, undefined when not sent or invalid. */
function rating(value: unknown): number | null | undefined {
  if (value === null) return null;
  const n = int(value);
  return n !== undefined && n >= 1 && n <= 5 ? n : undefined;
}

/** Optional text: undefined = not sent, null = cleared. */
function text(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  return str(value, max) ?? null;
}

/** The media library (see services/library/). */
export function registerLibraryRoutes(app: Express): void {
  app.use('/api/library', requirePermission('library.manage'));

  app.get(
    '/api/library',
    h((req, res) => {
      const kind = normalizeListKind(req.query.kind);
      const status = req.query.status;
      const items = listMedia(userId(req), {
        kind: isMediaKind(kind) ? kind : undefined,
        done: status === 'pending' ? false : status === 'done' ? true : undefined,
        search: str(req.query.q, 100) ?? undefined,
      });
      const lists = checklistsModel
        .list(userId(req))
        .map((l) => ({ id: l.id, name: l.name, kind: listKindOf(l) }))
        .filter((l) => isMediaKind(l.kind));
      res.json({
        kinds: MEDIA_KINDS,
        lists,
        items: items.map((i) => ({ ...i, related_notes: relatedNotes(userId(req), i, 2).map((n) => ({ id: n.id, title: n.title, content: n.content })) })),
      });
    }),
  );

  app.post(
    '/api/library',
    h((req, res) => {
      const kind = normalizeListKind(req.body?.kind);
      const title = str(req.body?.title, 200);
      if (!isMediaKind(kind) || !title) return void res.status(400).json({ error: 'Falta el tipo o el título.' });
      const url = req.body?.url ? normalizeHttpUrl(req.body.url) : undefined;
      if (url === null) return void res.status(400).json({ error: 'El link debe empezar por http:// o https://' });
      const result = saveMedia(userId(req), {
        kind,
        title,
        creator: str(req.body?.creator, 120),
        genre: str(req.body?.genre, 80),
        year: int(req.body?.year),
        summary: str(req.body?.summary, 1000),
        url,
        notes: str(req.body?.notes, 2000),
        list: str(req.body?.list, 120),
        rating: rating(req.body?.rating) ?? undefined,
        done: req.body?.done === true,
      });
      res.status(result.created ? 201 : 200).json(result);
    }),
  );

  app.patch(
    '/api/library/:id',
    h((req, res) => {
      const uid = userId(req);
      const item = checklistItemsModel.getById(uid, Number(req.params.id));
      const list = item ? checklistsModel.getById(uid, item.checklist_id) : undefined;
      if (!item || !list || !isMediaKind(listKindOf(list))) return void res.status(404).json({ error: 'No existe ese elemento.' });
      const kind = listKindOf(list);
      const target = str(req.body?.list, 120);
      const year = req.body?.year === null ? null : int(req.body?.year);
      checklistItemsModel.updateMedia(uid, item.id, {
        title: str(req.body?.title, 200),
        creator: text(req.body?.creator, 120),
        genre: text(req.body?.genre, 80),
        year,
        summary: text(req.body?.summary, 1000),
        notes: text(req.body?.notes, 2000),
        url: req.body?.url === undefined ? undefined : req.body.url ? (normalizeHttpUrl(req.body.url) ?? undefined) : null,
        rating: rating(req.body?.rating),
        checklistId: target && isMediaKind(kind) ? resolveMediaList(uid, kind, target).id : undefined,
      });
      if (typeof req.body?.done === 'boolean') checklistItemsModel.setChecked(uid, item.id, req.body.done);
      res.json({ ok: true });
    }),
  );

  app.delete(
    '/api/library/:id',
    h((req, res) => {
      checklistItemsModel.remove(userId(req), Number(req.params.id));
      res.json({ ok: true });
    }),
  );
}
