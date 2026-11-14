import { AccessError } from '../../../models/permissions.model.js';
import { promoModel } from '../../../models/promo.model.js';
import { reviewPromo } from '../../promo/promo.service.js';
import { generateAssets, mediaAccess, postFromAsset, resolveMedia } from '../publisher-media.js';
import { load, postView, schedule as schedulePost, suggestSeo, updatePost } from '../publisher.service.js';
import { fromDb, publisherStore, toDb } from '../publisher.store.js';
import { PLATFORMS, PLATFORM_MEDIA, PLATFORM_NAMES, type Platform } from '../publisher.types.js';
import { createDesigns, reviewDesign } from '../studio/studio.service.js';
import { studioStore } from '../studio/studio.store.js';
import { LAYOUTS, formatByKey } from '../studio/studio.types.js';
import { DEFAULT_TZ, localDay, validTime, validTimeZone, zonedToUtc } from './automation-time.js';
import { publisherHost } from './automation.host.js';
import { automationStore, type Run, type Schedule, type ScheduleInput } from './automation.store.js';

/**
 * Automation: recurring rules («lunes y jueves a las 8, un consejo en Instagram y Facebook») that
 * make the piece a few hours ahead (studio design or advertising video), write its SEO and either
 * leave it waiting for the administrator's OK or schedule it by themselves. Every minute the job
 * (publisher-job.ts) calls automationTick(): plan the runs that came into their window, move the open ones forward.
 */
const GRACE_MS = 6 * 3600_000; // a piece nobody approved is dropped this long after its time
const DEFAULT_LAYOUTS = ['hero', 'tip', 'quote', 'split'];

export const timeZone = (): string => publisherStore.getSetting('timezone') || DEFAULT_TZ;

export function saveTimeZone(tz: string): string {
  if (!validTimeZone(tz)) throw new AccessError('Esa zona horaria no existe (ej.: America/Bogota).');
  publisherStore.setSetting('timezone', tz);
  return tz;
}

// ---------- rules ----------

export interface ScheduleBody {
  name?: string;
  media?: string;
  format?: string;
  layouts?: string[];
  topics?: string[];
  platforms?: string[];
  days?: number[];
  time?: string;
  leadHours?: number;
  mode?: string;
  enabled?: boolean;
}

function clean(body: ScheduleBody, prev?: Schedule): ScheduleInput {
  const name = (body.name ?? prev?.name ?? '').trim().slice(0, 60);
  if (!name) throw new AccessError('Ponle un nombre a la programación.');
  const media = (body.media ?? prev?.media) === 'video' ? 'video' : 'image';
  let format = media === 'video' ? 'vertical' : (body.format ?? prev?.format ?? 'square');
  const spec = formatByKey(format);
  if (media === 'image' && (!spec || !['post', 'story'].includes(spec.kind))) throw new AccessError('Elige un formato de publicación o historia.');
  if (media === 'video') format = 'vertical';
  const platforms = [...new Set(body.platforms ?? prev?.platforms ?? [])].filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p));
  const supported = platforms.filter((p) => PLATFORM_MEDIA[p].includes(media === 'video' ? 'video' : 'image'));
  if (!supported.length) throw new AccessError(media === 'image' ? 'Las imágenes se publican en Instagram y Facebook: elige al menos una.' : 'Elige al menos una red.');
  const days = [...new Set((body.days ?? prev?.days ?? []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  if (!days.length) throw new AccessError('Elige al menos un día.');
  const time = body.time ?? prev?.time ?? '09:00';
  if (!validTime(time)) throw new AccessError('La hora debe ser como 08:30.');
  const layouts = media === 'image' ? (body.layouts ?? prev?.layouts ?? []).filter((l) => l in LAYOUTS && LAYOUTS[l as keyof typeof LAYOUTS].kinds.includes(spec!.kind)) : [];
  return {
    name,
    media,
    format,
    layouts,
    topics: (body.topics ?? prev?.topics ?? []).map((t) => t.trim().slice(0, 120)).filter(Boolean).slice(0, 30),
    platforms: supported,
    days,
    time,
    lead_hours: Math.max(1, Math.min(48, Math.trunc(body.leadHours ?? prev?.lead_hours ?? 8))),
    mode: (body.mode ?? prev?.mode) === 'auto' ? 'auto' : 'approve',
    enabled: body.enabled ?? prev?.enabled ?? true,
  };
}

export const createSchedule = (body: ScheduleBody) => automationStore.saveSchedule(clean(body));
export function updateSchedule(id: number, body: ScheduleBody) {
  const prev = automationStore.getSchedule(id);
  if (!prev) throw new AccessError('Esa programación ya no existe.');
  automationStore.saveSchedule(clean(body, prev), id);
}
export function deleteSchedule(id: number) {
  automationStore.deleteSchedule(id);
}
export function setScheduleEnabled(id: number, enabled: boolean) {
  if (!automationStore.getSchedule(id)) throw new AccessError('Esa programación ya no existe.');
  automationStore.setEnabled(id, enabled);
}

/** The instants this rule comes due, from `from` over the next `days` days. */
function occurrences(s: Schedule, from: Date, days: number): Date[] {
  const tz = timeZone();
  const out: Date[] = [];
  for (let i = 0; i <= days; i++) {
    const day = localDay(new Date(from.getTime() + i * 86400000), tz);
    if (!s.days.includes(day.weekday)) continue;
    const at = zonedToUtc(day.date, s.time, tz);
    if (at.getTime() > from.getTime()) out.push(at);
  }
  return out;
}

// ---------- views ----------

const when = (d: Date) => d.toLocaleString('es-CO', { timeZone: timeZone(), weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });

export function scheduleView(s: Schedule) {
  const next = occurrences(s, new Date(), 8)[0];
  const missing = s.platforms.filter((p) => !publisherStore.getConnection(p)).map((p) => PLATFORM_NAMES[p]);
  return { id: s.id, name: s.name, media: s.media, format: s.format, layouts: s.layouts, topics: s.topics, platforms: s.platforms, days: s.days, time: s.time, leadHours: s.lead_hours, mode: s.mode, enabled: s.enabled, nextAt: next ? next.toISOString() : null, missing };
}

export function runView(r: Run) {
  const s = automationStore.getSchedule(r.schedule_id);
  let preview = '';
  let title = '';
  if (r.item_kind === 'design' && r.item_id) {
    const d = studioStore.get(r.item_id);
    preview = resolveMedia(d?.file_ref ?? '');
    title = d?.title ?? '';
  } else if (r.item_id) {
    const p = promoModel.get(r.item_id);
    const f = p ? Object.values(p.files)[0] : undefined;
    preview = resolveMedia(f?.poster || f?.file || '');
    title = p?.title ?? '';
  }
  const post = r.post_id && publisherStore.getPost(r.post_id) ? postView(load(r.post_id), resolveMedia) : null;
  return { id: r.id, scheduleId: r.schedule_id, scheduleName: s?.name ?? '(eliminada)', media: s?.media ?? 'image', publishAt: fromDb(r.publish_at), status: r.status, detail: r.detail, title: post?.title || title, preview, post };
}

export const automationOverview = () => ({
  timezone: timeZone(),
  schedules: automationStore.listSchedules().map(scheduleView),
  runs: automationStore.listRuns().map(runView),
  awaiting: automationStore.awaitingCount(),
});

// ---------- the work ----------

const say = (text: string, image?: Buffer): Promise<string | null> => publisherHost().notify(text, { image }).catch((err) => (console.log('[PUBLISHER] Notice failed:', (err as Error).message), null));

/** The picture of what is waiting for approval (design, or the cover of the video), for the WhatsApp notice. */
async function previewBytes(run: Run): Promise<Buffer | undefined> {
  let ref = '';
  if (run.item_kind === 'design') ref = studioStore.get(run.item_id ?? 0)?.file_ref ?? '';
  else {
    const f = Object.values(promoModel.get(run.item_id ?? 0)?.files ?? {})[0];
    ref = f?.poster || f?.file || '';
  }
  return ref ? ((await mediaAccess.read(ref)) ?? undefined) : undefined;
}

function fail(run: Run, s: Schedule | undefined, detail: string) {
  automationStore.updateRun(run.id, { status: 'failed', detail: detail.slice(0, 300), notified: 2 });
  void say(`⚠️ No pude preparar «${s?.name ?? 'la publicación'}» (${when(new Date(`${run.publish_at.replace(' ', 'T')}Z`))}): ${detail}`);
}

async function startRun(s: Schedule, at: Date): Promise<void> {
  const publishAt = toDb(at);
  const adminId = publisherHost().adminId();
  const base = { scheduleId: s.id, publishAt };
  if (!adminId) {
    automationStore.createRun({ ...base, itemKind: 'design', itemId: null, status: 'failed', detail: 'No hay administrador.' });
    return;
  }
  const n = automationStore.runCount(s.id);
  const topic = s.topics.length ? s.topics[n % s.topics.length] : '';
  try {
    if (s.media === 'video') {
      const [item] = generateAssets(adminId, { media: 'video', kind: n % 2 ? 'howto' : 'ad', formats: ['vertical'], count: 1, idea: topic }).slice(0, 1);
      automationStore.createRun({ ...base, itemKind: 'promo', itemId: item.id, status: 'generating' });
      return;
    }
    const spec = formatByKey(s.format)!;
    const pool = s.layouts.length ? s.layouts : DEFAULT_LAYOUTS.filter((l) => LAYOUTS[l as keyof typeof LAYOUTS].kinds.includes(spec.kind));
    let layout = pool[n % pool.length];
    let made;
    try {
      made = createDesigns(adminId, { kind: spec.kind, layout, formats: [s.format], brief: topic, count: 1 });
    } catch (err) {
      // Out of budget for AI art: the free layouts keep the calendar going.
      if (!(err instanceof AccessError) || !/tope/.test(err.message)) throw err;
      layout = n % 2 ? 'quote' : 'tip';
      made = createDesigns(adminId, { kind: spec.kind, layout, formats: [s.format], brief: topic, count: 1 });
    }
    automationStore.createRun({ ...base, itemKind: 'design', itemId: made[0].id, status: 'generating' });
  } catch (err) {
    const id = automationStore.createRun({ ...base, itemKind: 'design', itemId: null, status: 'failed', detail: (err as Error).message.slice(0, 300) });
    const run = automationStore.getRun(id)!;
    fail(run, s, (err as Error).message);
  }
}

/** Runs that came into their window (publish time minus lead hours) get started. */
async function plan(): Promise<void> {
  const now = new Date();
  for (const s of automationStore.listSchedules().filter((x) => x.enabled)) {
    try {
      for (const at of occurrences(s, now, 2)) {
        if (at.getTime() - s.lead_hours * 3600_000 > now.getTime()) continue;
        if (automationStore.runExists(s.id, toDb(at))) continue;
        await startRun(s, at);
      }
    } catch (err) {
      console.log('[PUBLISHER] Plan failed for schedule %d: %s', s.id, (err as Error).message);
    }
  }
}

/** Approves the piece, makes the post (networks + SEO) and schedules it for its time. */
async function approveAndSchedule(run: Run, s: Schedule): Promise<void> {
  const adminId = publisherHost().adminId();
  if (run.item_kind === 'design') {
    const d = studioStore.get(run.item_id!);
    if (d?.status === 'review') reviewDesign(d.id, true);
  } else {
    const p = promoModel.get(run.item_id!);
    if (p?.status === 'review') reviewPromo(p.id, true);
  }
  const brand = publisherStore.getBrand();
  const post = postFromAsset(adminId, `${run.item_kind === 'design' ? 'd' : 'p'}${run.item_id}`, { keywords: brand.keywords, hashtags: brand.hashtags });
  const platforms = s.platforms.filter((p) => publisherStore.getConnection(p) && PLATFORM_MEDIA[p].includes(post.media_type));
  if (!platforms.length) {
    publisherStore.deletePost(post.id);
    return fail(run, s, 'Ninguna de las redes elegidas está conectada.');
  }
  updatePost(post.id, { platforms });
  await suggestSeo(post.id, adminId);
  const publishAt = new Date(`${run.publish_at.replace(' ', 'T')}Z`);
  schedulePost(post.id, new Date(Math.max(publishAt.getTime(), Date.now() + 45_000)).toISOString());
  automationStore.updateRun(run.id, { status: 'scheduled', post_id: post.id, detail: '', notified: Math.max(run.notified, 1) });
  if (s.mode === 'auto') void say(`🗓️ Programé «${load(post.id).title}» para ${when(publishAt)} en ${platforms.map((p) => PLATFORM_NAMES[p]).join(' y ')}.`);
}

export async function approveRun(id: number): Promise<ReturnType<typeof runView>> {
  const run = automationStore.getRun(id);
  const s = run && automationStore.getSchedule(run.schedule_id);
  if (!run || !s) throw new AccessError('Esa publicación ya no existe.');
  if (run.status !== 'awaiting') throw new AccessError('Esta publicación ya no está esperando aprobación.');
  await approveAndSchedule(run, s);
  return runView(automationStore.getRun(id)!);
}

export function skipRun(id: number) {
  const run = automationStore.getRun(id);
  if (!run || !['awaiting', 'generating'].includes(run.status)) throw new AccessError('Esta publicación ya no se puede omitir.');
  automationStore.updateRun(id, { status: 'skipped', detail: 'La omitiste.', notified: 2 });
}

/** «Preparar ahora»: makes the next one without waiting for its window (to see what comes out). */
export async function runNow(scheduleId: number): Promise<void> {
  const s = automationStore.getSchedule(scheduleId);
  if (!s) throw new AccessError('Esa programación ya no existe.');
  const next = occurrences(s, new Date(), 8).find((at) => !automationStore.runExists(s.id, toDb(at)));
  if (!next) throw new AccessError('Ya están preparadas las próximas publicaciones de esta programación.');
  await startRun(s, next);
}

async function advance(run: Run): Promise<void> {
  const s = automationStore.getSchedule(run.schedule_id);
  if (!s) return void automationStore.updateRun(run.id, { status: 'skipped', detail: 'La programación se eliminó.', notified: 2 });
  const at = new Date(`${run.publish_at.replace(' ', 'T')}Z`);

  if (run.status === 'generating') {
    const state = run.item_kind === 'design' ? studioStore.get(run.item_id ?? 0) : promoModel.get(run.item_id ?? 0);
    if (!state) return fail(run, s, 'La pieza ya no existe.');
    if (state.status === 'error') return fail(run, s, state.detail || 'No se pudo crear la pieza.');
    if (state.status !== 'review' && state.status !== 'approved') return; // still being made
    if (s.mode === 'auto') return approveAndSchedule(run, s);
    automationStore.updateRun(run.id, { status: 'awaiting', notified: 1 });
    const noticeId = await say(`📣 Publicación lista para aprobar
«${state.title || s.name}»
Sale ${when(at)} en ${s.platforms.map((p) => PLATFORM_NAMES[p]).join(' y ')}.

👍 para aprobarla y programarla · 👎 para omitirla
(o cámbiala en Publicador → Automático)`, await previewBytes(run).catch(() => undefined));
    if (noticeId) automationStore.setNotice(run.id, noticeId);
    return;
  }

  if (run.status === 'awaiting') {
    if (Date.now() > at.getTime() + GRACE_MS) {
      automationStore.updateRun(run.id, { status: 'skipped', detail: 'Nadie la aprobó a tiempo.', notified: 2 });
      void say(`⏭️ «${s.name}» (${when(at)}) no se aprobó a tiempo y se omitió.`);
    }
    return;
  }

  if (run.status === 'scheduled') {
    const post = run.post_id ? publisherStore.getPost(run.post_id) : undefined;
    if (!post) return void automationStore.updateRun(run.id, { status: 'skipped', detail: 'La publicación se borró.', notified: 2 });
    if (!['published', 'partial', 'failed'].includes(post.status)) return;
    const targets = publisherStore.listTargets(post.id);
    const ok = targets.filter((t) => t.status === 'published').map((t) => PLATFORM_NAMES[t.platform]);
    const bad = targets.filter((t) => t.status === 'failed');
    automationStore.updateRun(run.id, { status: post.status as 'published' | 'partial' | 'failed', detail: bad.map((t) => `${PLATFORM_NAMES[t.platform]}: ${t.last_error}`).join(' · ').slice(0, 300), notified: 2 });
    if (post.status === 'published') void say(`✅ Publicado «${post.title}» en ${ok.join(' y ')}.`);
    else void say(`⚠️ «${post.title}»: ${ok.length ? `salió en ${ok.join(' y ')}, pero ` : ''}falló en ${bad.map((t) => `${PLATFORM_NAMES[t.platform]} (${t.last_error})`).join('; ')}. Revísalo en Publicador → Cola.`);
  }
}

let ticking = false;
export async function automationTick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await plan();
    for (const run of automationStore.openRuns()) {
      try {
        await advance(run);
      } catch (err) {
        console.log('[PUBLISHER] Run %d failed: %s', run.id, (err as Error).message);
        fail(run, automationStore.getSchedule(run.schedule_id), (err as Error).message);
      }
    }
  } finally {
    ticking = false;
  }
}

const POSITIVE = ['👍', '✅', '👌', '🙌', '🔥', '❤'];
const NEGATIVE = ['👎', '❌', '🚫'];

/**
 * The administrator reacted to a WhatsApp message. If it is the notice of a piece waiting for
 * approval, 👍 approves and schedules it and 👎 skips it. Returns handled = false when the message
 * isn't one of ours (the caller keeps looking), and a reply to send back when there is something to say.
 */
export async function handlePublisherReaction(targetId: string, emoji: string): Promise<{ handled: boolean; reply?: string }> {
  const run = automationStore.runByNotice(targetId);
  if (!run) return { handled: false };
  const positive = POSITIVE.some((e) => emoji.startsWith(e));
  if (!positive && !NEGATIVE.some((e) => emoji.startsWith(e))) return { handled: true };
  if (run.status !== 'awaiting') return { handled: true }; // already decided (from the panel, or it expired)
  try {
    if (positive) {
      const view = await approveRun(run.id);
      return { handled: true, reply: `✅ Aprobada y programada para ${view.publishAt ? when(new Date(view.publishAt)) : 'pronto'}.` };
    }
    skipRun(run.id);
    return { handled: true, reply: '⏭️ Listo, la omití.' };
  } catch (err) {
    return { handled: true, reply: `No pude hacerlo: ${(err as Error).message}` };
  }
}
