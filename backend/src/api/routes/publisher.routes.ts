import type { Express } from 'express';
import { env } from '../../config/env.js';
import { AccessError } from '../../models/permissions.model.js';
import { approvedAssets, generateAssets, generatedThisMonth, generationCap, mediaAccess, postFromAsset, resolveMedia, setGenerationCap } from '../../services/publisher/publisher-media.js';
import {
  connect, connectionsView, disconnect, getBrand, load, postView, providersView, removePost, retry, runDue, saveBrand, schedule, suggestSeo, unschedule, updatePost,
} from '../../services/publisher/publisher.service.js';
import { beginOAuth, finishOAuth } from '../../services/publisher/publisher-oauth.js';
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
  // «Conectar con…»: returns the platform's login page (the panel navigates to it).
  app.post('/api/admin/publisher/connections/:platform/start', h((req, res) => res.json({ url: beginOAuth(String(req.params.platform), str(req.body?.provider, 20) ?? '') })));
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
      if (!at) await runDue(mediaAccess);
      res.json(view(id));
    }),
  );

  app.post('/api/admin/publisher/posts/:id/unschedule', h((req, res) => res.json(view(unschedule(Number(req.params.id)).id))));

  app.post(
    '/api/admin/publisher/posts/:id/retry',
    h(async (req, res) => {
      const id = Number(req.params.id);
      retry(id);
      await runDue(mediaAccess);
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

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Where the platform sends the administrator back after the login page. Public on purpose (the
 * browser arrives from another site without our Bearer token): it only works with a `state`
 * created by the signed-in administrator, valid once for 10 minutes (see publisher-oauth.ts).
 * Registered BEFORE the panel authentication in server.ts.
 */
export function registerPublisherPublicRoutes(app: Express): void {
  app.get(
    '/api/publisher-oauth/callback',
    h(async (req, res) => {
      const page = (title: string, text: string) =>
        res
          .status(200)
          .type('html')
          .send(
            `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>` +
              `<body style="font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;text-align:center"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p><p><a href="/">Volver al panel</a></p>`,
          );
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      if (!state || !code) return page('No se conectó', 'La plataforma no devolvió la autorización (¿la rechazaste?). Vuelve al panel e inténtalo de nuevo.');
      try {
        const platform = await finishOAuth(state, code);
        return page('¡Listo!', `${platform === 'youtube' ? 'YouTube' : platform} quedó conectada. Ya puedes volver al panel.`);
      } catch (err) {
        return page('No se conectó', (err as Error).message);
      }
    }),
  );
}
