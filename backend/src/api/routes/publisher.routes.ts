import type { Express } from 'express';
import { env } from '../../config/env.js';
import { AccessError } from '../../models/permissions.model.js';
import { approvedAssets, generateAssets, generatedThisMonth, generationCap, postFromAsset, resolveMedia, setGenerationCap } from '../../services/publisher/publisher-media.js';
import {
  connect, connectionsView, disconnect, getBrand, load, postView, providersView, removePost, retry, runDue, saveBrand, schedule, suggestSeo, unschedule, updatePost,
} from '../../services/publisher/publisher.service.js';
import { publisherStore } from '../../services/publisher/publisher.store.js';
import { PLATFORMS } from '../../services/publisher/publisher.types.js';
import { h, int, str, strArr, userId } from '../http-helpers.js';

/**
 * Content publisher (/api/admin/publisher/*, admin only - mounted behind requirePanelAdmin by
 * admin.routes.ts): brand profile, connected accounts, the queue and the generation of material.
 */
export function registerPublisherRoutes(app: Express): void {
  const view = (id: number) => postView(load(id), resolveMedia);

  app.get(
    '/api/admin/publisher',
    h((_req, res) =>
      res.json({
        brand: getBrand(),
        connections: connectionsView(),
        providers: providersView(),
        platforms: PLATFORMS,
        posts: publisherStore.listPosts().map((p) => postView(p, resolveMedia)),
        assets: approvedAssets(),
        generation: { cap: generationCap(), used: generatedThisMonth(), textAi: !!env.ai.apiKey },
      }),
    ),
  );

  app.put(
    '/api/admin/publisher/brand',
    h((req, res) =>
      res.json(
        saveBrand({
          name: str(req.body?.name, 60),
          tone: str(req.body?.tone, 300),
          language: str(req.body?.language, 5),
          audience: str(req.body?.audience, 300),
          cta: str(req.body?.cta, 200),
          hashtags: req.body?.hashtags === undefined ? undefined : strArr(req.body.hashtags),
          keywords: req.body?.keywords === undefined ? undefined : strArr(req.body.keywords),
        }),
      ),
    ),
  );

  app.put(
    '/api/admin/publisher/settings',
    h((req, res) => {
      setGenerationCap(Number(req.body?.cap));
      res.json({ cap: generationCap(), used: generatedThisMonth() });
    }),
  );

  app.post('/api/admin/publisher/connections/:platform', h(async (req, res) => res.json(await connect(String(req.params.platform), str(req.body?.provider, 20) ?? 'mock', str(req.body?.account, 80) ?? ''))));
  app.delete('/api/admin/publisher/connections/:platform', h((req, res) => res.json(disconnect(String(req.params.platform)))));

  // New material (spends money: monthly cap). Same body as the advertising module.
  app.post(
    '/api/admin/publisher/generate',
    h((req, res) => {
      const media = req.body?.media === 'image' ? 'image' : 'video';
      res.json({
        items: generateAssets(userId(req), {
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

  app.post(
    '/api/admin/publisher/posts',
    h((req, res) => {
      const promoId = int(req.body?.promoId);
      const extra = { keywords: strArr(req.body?.keywords), hashtags: strArr(req.body?.hashtags) };
      if (promoId === undefined) throw new AccessError('Elige el video o la imagen que quieres publicar.');
      res.json(view(postFromAsset(userId(req), promoId, extra).id));
    }),
  );

  app.put(
    '/api/admin/publisher/posts/:id',
    h((req, res) => {
      const id = Number(req.params.id);
      updatePost(id, {
        title: str(req.body?.title, 120),
        description: str(req.body?.description, 2000),
        hashtags: req.body?.hashtags === undefined ? undefined : strArr(req.body.hashtags),
        keywords: req.body?.keywords === undefined ? undefined : strArr(req.body.keywords),
        seo: typeof req.body?.seo === 'object' && req.body.seo ? req.body.seo : undefined,
        platforms: req.body?.platforms === undefined ? undefined : strArr(req.body.platforms),
      });
      res.json(view(id));
    }),
  );

  app.post(
    '/api/admin/publisher/posts/:id/seo',
    h(async (req, res) => {
      const id = Number(req.params.id);
      const { usedAi } = await suggestSeo(id, userId(req), req.body?.platforms === undefined ? undefined : strArr(req.body.platforms));
      res.json({ post: view(id), usedAi });
    }),
  );

  // at = ISO date to schedule; empty = publish now.
  app.post(
    '/api/admin/publisher/posts/:id/schedule',
    h(async (req, res) => {
      const id = Number(req.params.id);
      const at = str(req.body?.at, 40);
      schedule(id, at || null);
      if (!at) await runDue(resolveMedia);
      res.json(view(id));
    }),
  );

  app.post('/api/admin/publisher/posts/:id/unschedule', h((req, res) => res.json(view(unschedule(Number(req.params.id)).id))));

  app.post(
    '/api/admin/publisher/posts/:id/retry',
    h(async (req, res) => {
      const id = Number(req.params.id);
      retry(id);
      await runDue(resolveMedia);
      res.json(view(id));
    }),
  );

  app.delete(
    '/api/admin/publisher/posts/:id',
    h((req, res) => {
      removePost(Number(req.params.id));
      res.json({ ok: true });
    }),
  );
}
