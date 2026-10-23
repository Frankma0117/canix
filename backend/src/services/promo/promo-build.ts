import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '../../config/env.js';
import { getAiClient } from '../../agent/llm-provider.js';
import { fishTts, isFishConfigured } from '../audio/fish-audio.js';
import { VOICES } from '../audio/voices.js';
import { aiUsageModel } from '../../models/ai-usage.model.js';
import { promoModel } from '../../models/promo.model.js';
import type { ChatLine, PromoItem, PromoFile, PromoScene } from '../../entities/promo.entity.js';
import { MUSIC, featureByKey } from './promo-catalog.js';
import { IMAGE_RULES, VIDEO_RULES, cleanImage, cleanVideo, imagePrompt, imageTemplate, videoPrompt, videoTemplate, type ImageCopy, type VideoScript } from './promo-copy.js';
import * as render from './promo-render.js';
import { deleteFiles, putFile, readFile } from './promo-storage.js';

/**
 * Builds one piece of advertising material (runs inside promo-worker.ts):
 *   video: script (text model or template) → one narration clip per scene with the chosen voice →
 *          the chat timing → soundtrack (voice + music + chat sounds) → recording of each format;
 *   image: texts (text model or template) → one photo of the stage per format.
 * The texts already saved are kept (a redraw after the admin corrected them spends no AI).
 */

export const DEFAULT_VOICE = 'M5';

const progress = (id: number, msg: string) => promoModel.setStatus(id, 'working', msg);

function host(): string {
  const url = env.growth.landingUrl || env.panelUrl || 'https://canix.cania.app';
  return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

async function askModel(userId: number | null, system: string, prompt: string): Promise<unknown> {
  const { client, model } = getAiClient();
  const res = await client.chat.completions.create({
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    temperature: 0.8,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  });
  if (res.usage && userId) aiUsageModel.log(userId, 'promo.text', model, res.usage.prompt_tokens, res.usage.completion_tokens);
  return JSON.parse(res.choices[0]?.message?.content ?? '{}');
}

export async function build(id: number): Promise<void> {
  const item = promoModel.get(id);
  if (!item || !['pending', 'working'].includes(item.status)) return;
  promoModel.setStatus(id, 'working', 'Empezando…');
  const work = render.workdir();
  try {
    if (item.media === 'video') await buildVideo(item, work);
    else await buildImage(item);
  } finally {
    render.cleanup(work);
  }
}

// ---------- video ----------

async function videoScript(item: PromoItem): Promise<VideoScript> {
  if (item.content.scenes?.length) return { title: item.title, caption: item.caption, scenes: item.content.scenes };
  const avoid = promoModel.recentTitles('video', item.kind, item.feature);
  const fallback = videoTemplate(item.kind, item.feature, avoid.length);
  if (!env.ai.apiKey) return fallback;
  progress(item.id, 'Escribiendo el guion…');
  try {
    return cleanVideo(await askModel(item.created_by, VIDEO_RULES, videoPrompt(item.kind, item.feature, item.idea, avoid)), fallback);
  } catch (err) {
    console.log('[PROMO] Script from the model failed (%s); using the template', (err as Error).message);
    return fallback;
  }
}

/** When each chat message shows up inside its scene (the stage and the sounds use the same numbers). */
function chatTiming(chat: ChatLine[], from: number): { lines: (ChatLine & { at: number; typing?: number })[]; end: number } {
  let t = from + 0.3;
  const lines = chat.map((c) => {
    let typing: number | undefined;
    if (c.from === 'canix') {
      typing = t;
      t += 0.9;
    } else t += 0.35;
    const line = { ...c, at: Number(t.toFixed(3)), ...(typing !== undefined ? { typing: Number(typing.toFixed(3)) } : {}) };
    t += 0.6 + Math.min(c.text.length, 120) / 28;
    return line;
  });
  return { lines, end: t + 0.4 };
}

async function music(work: string): Promise<string | null> {
  const key = promoModel.getSetting('music') ?? 'moderna';
  const choice = MUSIC.find((m) => m.key === key);
  if (!choice) return null;
  let ref = promoModel.getSetting(`music:${key}`);
  if (!ref && env.fal.apiKey) {
    try {
      const res = await fetch('https://fal.run/CassetteAI/music-generator', {
        method: 'POST',
        headers: { Authorization: `Key ${env.fal.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: choice.prompt, duration: 60 }),
        signal: AbortSignal.timeout(240_000),
      });
      const out = (await res.json()) as { audio_file?: { url?: string } };
      const url = new URL(out.audio_file?.url ?? '');
      if (url.protocol !== 'https:' || !/(^|\.)fal\.(media|ai)$/.test(url.hostname)) throw new Error('respuesta inesperada');
      const wav = render.writeTemp(work, 'music-raw.wav', Buffer.from(await (await fetch(url)).arrayBuffer()));
      const mp3 = join(work, 'music-new.mp3');
      await render.toMp3(wav, mp3, 60);
      ref = await putFile('music', `${key}.mp3`, readFileSync(mp3), 'audio/mpeg');
      promoModel.setSetting(`music:${key}`, ref);
    } catch (err) {
      console.log('[PROMO] Music could not be generated (%s); the video goes without music', (err as Error).message);
      return null;
    }
  }
  const data = ref ? await readFile(ref) : null;
  return data ? render.writeTemp(work, 'music.mp3', data) : null;
}

async function buildVideo(item: PromoItem, work: string): Promise<void> {
  const script = await videoScript(item);
  promoModel.setContent(item.id, item.title || script.title, item.caption || script.caption, { scenes: script.scenes });
  const voice = VOICES.find((v) => v.key === (item.voice || DEFAULT_VOICE)) ?? VOICES[0];
  const feature = featureByKey(item.feature);

  // 1. narration (one clip per scene) and the timeline
  const clips: [string, number][] = [];
  const effects: [string, number, number][] = [];
  const sounds = await render.chatSounds(work);
  const timeline: (PromoScene & { start: number; dur: number; say_start: number; say_dur: number })[] = [];
  let t = 0;
  for (const [i, scene] of script.scenes.entries()) {
    progress(item.id, `Grabando la voz (${i + 1} de ${script.scenes.length})…`);
    const lead = i === 0 ? 0.5 : 0.35;
    let said = scene.say.length / 14;
    const mp3 = isFishConfigured() ? await fishTts(scene.say, voice.id) : null;
    if (mp3) {
      const path = render.writeTemp(work, `say-${i}.mp3`, mp3);
      said = (await render.durationOf(path)) || said;
      clips.push([path, t + lead]);
      if (item.created_by) aiUsageModel.log(item.created_by, 'voice.fish.promo', env.audio.fish.model, scene.say.length, 0);
    }
    let dur = Math.max(2.6, lead + said + 0.55);
    let chat: ReturnType<typeof chatTiming>['lines'] | undefined;
    if (scene.shot === 'chat' && scene.chat) {
      const timing = chatTiming(scene.chat, 0);
      chat = timing.lines;
      dur = Math.max(dur, timing.end);
      for (const line of chat) effects.push([line.from === 'me' ? sounds.sent : sounds.received, t + line.at, 1]);
    }
    if (scene.shot === 'end') dur += 1.4;
    timeline.push({ ...scene, ...(chat ? { chat } : {}), start: +t.toFixed(3), dur: +dur.toFixed(3), say_start: +(t + lead).toFixed(3), say_dur: +said.toFixed(3) });
    t += dur;
  }
  const total = +t.toFixed(3);

  // 2. soundtrack
  progress(item.id, 'Mezclando el sonido…');
  const audio = join(work, 'audio.m4a');
  await render.soundtrack(clips, effects, await music(work), total, audio);

  // 3. each format
  const files: Record<string, PromoFile> = {};
  const hook = timeline[0];
  for (const fmt of item.formats as (keyof typeof render.VIDEO_SIZES)[]) {
    const label = fmt === 'vertical' ? 'vertical' : 'horizontal';
    const stage = { mode: 'video', format: fmt, total, host: host(), feature: feature ? { name: feature.name, emoji: feature.emoji, sticker: feature.sticker } : null, scenes: timeline };
    const silent = join(work, `${fmt}-silent.mp4`);
    const cover = await render.renderVideo(stage, fmt, silent, hook.start + hook.dur - 0.4, (f) => progress(item.id, `Grabando el video ${label}: ${Math.round(f * 100)} %`));
    const final = join(work, `${fmt}.mp4`);
    await render.mux(silent, audio, final);
    const stamp = Date.now().toString(36);
    files[fmt] = {
      file: await putFile(item.id, `${fmt}-${stamp}.mp4`, readFileSync(final), 'video/mp4'),
      poster: await putFile(item.id, `${fmt}-${stamp}.jpg`, cover, 'image/jpeg'),
      seconds: total,
    };
  }
  await replaceFiles(item, files);
}

// ---------- image ----------

async function imageCopy(item: PromoItem): Promise<ImageCopy> {
  const c = item.content;
  if (c.headline) return { title: item.title, caption: item.caption, headline: c.headline, sub: c.sub ?? '', bullets: c.bullets ?? [], cta: c.cta ?? '', chat: c.chat ?? [] };
  const avoid = promoModel.recentTitles('image', item.kind, item.feature);
  const fallback = imageTemplate(item.kind, item.feature, avoid.length);
  if (!env.ai.apiKey) return fallback;
  progress(item.id, 'Escribiendo los textos…');
  try {
    return cleanImage(await askModel(item.created_by, IMAGE_RULES, imagePrompt(item.kind, item.feature, item.layout ?? 'chat', item.idea, avoid)), fallback);
  } catch (err) {
    console.log('[PROMO] Image copy from the model failed (%s); using the template', (err as Error).message);
    return fallback;
  }
}

async function buildImage(item: PromoItem): Promise<void> {
  const copy = await imageCopy(item);
  const { title, caption, ...content } = copy;
  promoModel.setContent(item.id, item.title || title, item.caption || caption, content);
  const feature = featureByKey(item.feature);
  const files: Record<string, PromoFile> = {};
  for (const [i, fmt] of (item.formats as (keyof typeof render.IMAGE_SIZES)[]).entries()) {
    progress(item.id, `Armando la imagen (${i + 1} de ${item.formats.length})…`);
    const stage = { mode: 'image', format: fmt, layout: item.layout ?? 'chat', host: host(), feature: feature ? { name: feature.name, emoji: feature.emoji, sticker: feature.sticker } : null, ...content };
    const jpg = await render.renderImage(stage, fmt);
    files[fmt] = { file: await putFile(item.id, `${fmt}-${Date.now().toString(36)}.jpg`, jpg, 'image/jpeg') };
  }
  await replaceFiles(item, files);
}

/** Saves the new files and removes the previous ones of the same item (a redraw). */
async function replaceFiles(item: PromoItem, files: Record<string, PromoFile>): Promise<void> {
  const fresh = promoModel.get(item.id);
  const old = Object.values(fresh?.files ?? {}).flatMap((f) => [f.file, f.poster].filter((x): x is string => !!x));
  promoModel.setResult(item.id, files);
  await deleteFiles(item.id, old);
}
