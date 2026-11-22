import type { Express } from 'express';
import { env } from '../../config/env.js';
import { approvedAssets, generateAssets, generationCap, mediaAccess, postFromAsset, resolveMedia, setGenerationCap, usedThisMonth } from '../../services/publisher/publisher-media.js';
import {
  connect, connectionsView, disconnect, getBrand, load, postView, providersView, removePost, retry, runDue, saveBrand, schedule, suggestSeo, unschedule, updatePost,
} from '../../services/publisher/publisher.service.js';
import { approveRun, automationOverview, createSchedule, deleteSchedule, runNow, saveTimeZone, setScheduleEnabled, skipRun, updateSchedule, type ScheduleBody } from '../../services/publisher/automation/automation.service.js';
import { chooseProviders, deleteAsset, failInterruptedAssets, generateImage, generateVideo, generationStatus, listAssets, setCostCapCents } from '../../services/publisher/generation/generation.service.js';
import { beginOAuth, finishOAuth } from '../../services/publisher/publisher-oauth.js';
import { publisherStore } from '../../services/publisher/publisher.store.js';
import { PLATFORMS } from '../../services/publisher/publisher.types.js';
import { createDesigns, deleteDesign, editDesign, listDesigns, redoDesign, resumeStudioQueue, reviewDesign, saveIdentity, studioStatus, useAsLogo } from '../../services/publisher/studio/studio.service.js';
import { h, int, intArr, str, strArr, userId } from '../http-helpers.js';

/**
 * Content publisher (/api/admin/publisher/*, admin only - mounted behind requirePanelAdmin by
 * admin.routes.ts): brand profile, connected accounts, the queue and the generation of material.
 */
export function registerPublisherRoutes(app: Express): void {
  const view = (id: number) => postView(load(id), resolveMedia);
  resumeStudioQueue();
  failInterruptedAssets();

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
        generation: { cap: generationCap(), used: usedThisMonth(), textAi: !!env.ai.apiKey, ...generationStatus() },
        awaiting: automationOverview().awaiting,
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
      if (req.body?.cap !== undefined) setGenerationCap(Number(req.body.cap));
      // The spending cap arrives in dollars; it is stored in cents.
      if (req.body?.costCapUsd !== undefined) setCostCapCents(Math.round(Number(req.body.costCapUsd) * 100));
      if (req.body?.imageProvider !== undefined || req.body?.videoProvider !== undefined) chooseProviders({ image: str(req.body?.imageProvider, 20), video: str(req.body?.videoProvider, 20) });
      res.json({ cap: generationCap(), used: usedThisMonth(), ...generationStatus() });
    }),
  );

  // Images and videos made by the project's providers (simulated ones cost nothing). They answer at once
  // with a «working» piece; the panel reads the list until it is «ready».
  app.get('/api/admin/publisher/generation', h((_req, res) => res.json({ ...generationStatus(), assets: listAssets() })));
  app.post('/api/admin/publisher/generation/image', h((req, res) => res.json(generateImage(userId(req), req.body ?? {}))));
  app.post('/api/admin/publisher/generation/video', h((req, res) => res.json(generateVideo(userId(req), req.body ?? {}))));
  app.delete('/api/admin/publisher/generation/:id', h(async (req, res) => { await deleteAsset(Number(req.params.id)); res.json({ ok: true }); }));

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

  // ---------- automation: recurring rules and their runs ----------
  const scheduleBody = (b: Record<string, unknown>): ScheduleBody => ({
    name: str(b?.name, 60),
    media: str(b?.media, 10),
    format: str(b?.format, 30),
    layouts: b?.layouts === undefined ? undefined : strArr(b.layouts),
    topics: b?.topics === undefined ? undefined : strArr(b.topics),
    platforms: b?.platforms === undefined ? undefined : strArr(b.platforms),
    days: b?.days === undefined ? undefined : intArr(b.days),
    time: str(b?.time, 5),
    leadHours: int(b?.leadHours),
    mode: str(b?.mode, 10),
    enabled: typeof b?.enabled === 'boolean' ? b.enabled : undefined,
  });
  app.get('/api/admin/publisher/automation', h((_req, res) => res.json(automationOverview())));
  app.put('/api/admin/publisher/automation/timezone', h((req, res) => res.json({ timezone: saveTimeZone(str(req.body?.timezone, 60) ?? '') })));
  app.post('/api/admin/publisher/automation/schedules', h((req, res) => res.json({ id: createSchedule(scheduleBody(req.body)) })));
  app.put('/api/admin/publisher/automation/schedules/:id', h((req, res) => (updateSchedule(Number(req.params.id), scheduleBody(req.body)), res.json({ ok: true }))));
  app.post('/api/admin/publisher/automation/schedules/:id/enabled', h((req, res) => (setScheduleEnabled(Number(req.params.id), req.body?.enabled === true), res.json({ ok: true }))));
  app.post('/api/admin/publisher/automation/schedules/:id/run-now', h(async (req, res) => (await runNow(Number(req.params.id)), res.json({ ok: true }))));
  app.delete('/api/admin/publisher/automation/schedules/:id', h((req, res) => (deleteSchedule(Number(req.params.id)), res.json({ ok: true }))));
  app.post('/api/admin/publisher/automation/runs/:id/approve', h(async (req, res) => res.json(await approveRun(Number(req.params.id)))));
  app.post('/api/admin/publisher/automation/runs/:id/skip', h((req, res) => (skipRun(Number(req.params.id)), res.json({ ok: true }))));

  // ---------- brand studio: identity and designs ----------
  app.get('/api/admin/publisher/studio', h(async (_req, res) => res.json({ status: await studioStatus(), designs: listDesigns() })));

  app.put(
    '/api/admin/publisher/studio/identity',
    h((req, res) => res.json(saveIdentity({ colors: typeof req.body?.colors === 'object' ? req.body.colors : undefined, style: str(req.body?.style, 300), font: str(req.body?.font, 20) }))),
  );

  app.post(
    '/api/admin/publisher/studio/designs',
    h((req, res) =>
      res.json({ items: createDesigns(userId(req), { kind: str(req.body?.kind, 20) ?? '', layout: str(req.body?.layout, 20), formats: strArr(req.body?.formats), brief: str(req.body?.brief, 500), count: int(req.body?.count) }) }),
    ),
  );

  app.post('/api/admin/publisher/studio/designs/:id/review', h((req, res) => res.json(reviewDesign(Number(req.params.id), req.body?.approve === true))));
  app.post('/api/admin/publisher/studio/designs/:id/redo', h((req, res) => res.json({ items: redoDesign(userId(req), Number(req.params.id)) })));
  app.post('/api/admin/publisher/studio/designs/:id/logo', h((req, res) => res.json(useAsLogo(Number(req.params.id)))));

  app.put(
    '/api/admin/publisher/studio/designs/:id',
    h((req, res) =>
      res.json(
        editDesign(Number(req.params.id), {
          headline: str(req.body?.headline, 90),
          sub: str(req.body?.sub, 110),
          cta: str(req.body?.cta, 28),
          caption: str(req.body?.caption, 600),
          bullets: Array.isArray(req.body?.bullets) ? strArr(req.body.bullets) : undefined,
        }),
      ),
    ),
  );

  app.delete(
    '/api/admin/publisher/studio/designs/:id',
    h(async (req, res) => {
      await deleteDesign(Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  app.post(
    '/api/admin/publisher/posts',
    h((req, res) => {
      const assetId = str(req.body?.asset, 20) ?? '';
      const extra = { keywords: strArr(req.body?.keywords), hashtags: strArr(req.body?.hashtags) };
      res.json(view(postFromAsset(userId(req), assetId, extra).id));
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
