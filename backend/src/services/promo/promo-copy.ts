import type { ChatLine, ImageContent, PromoKind, PromoScene } from '../../entities/promo.entity.js';
import { FEATURES, PRODUCT_FACTS, featureByKey, type PromoFeature } from './promo-catalog.js';

/**
 * The words of the advertising material: the video scripts and the image texts.
 *
 * The text model (the same OpenAI-compatible one the agent uses) writes them following RULES with
 * the real facts of promo-catalog.ts; when it is off or answers something invalid the fixed
 * templates below are used. Either way the result goes through clean*(), so the stage never gets a
 * scene it can't draw or a text too long to read.
 */

const SHOTS: PromoScene['shot'][] = ['hook', 'chat', 'features', 'steps', 'cta', 'end'];
const MAX_TEXT = 60;
const MAX_SAY = 230;
const MAX_LINE = 120;
const MAX_SCENES = 8;

const SHOT_HELP: Record<PromoScene['shot'], string> = {
  hook: 'portada animada con el titular y la mascota (siempre la primera)',
  chat: 'un celular con un chat de WhatsApp: la persona escribe y Canix responde (lleva "chat": 2 a 4 mensajes)',
  features: 'tarjetas con funciones (lleva "items": 3 a 6 textos cortos con un emoji al inicio)',
  steps: 'tres pasos numerados: escríbele, Canix lo organiza, te avisa a tiempo (lleva "items": 3 textos cortos)',
  cta: 'llamado a la acción: pedir la demo gratis por WhatsApp',
  end: 'cierre con el logo y la dirección web (siempre la última)',
};

const GOALS: Record<PromoKind, string> = {
  ad: 'un anuncio corto y emocionante para redes sociales (unos 20 a 30 segundos)',
  howto: 'un video que explique cómo funciona Canix y cómo empezar, de principio a fin (unos 40 a 55 segundos)',
  feature: 'un video que muestre una función de Canix con un ejemplo real de chat (unos 25 a 40 segundos)',
};

const BASE_RULES = `Escribes en español latino, cercano, tuteando, sin regionalismos fuertes. Canix es "él" (un asistente).
- Específico: usa las funciones y ejemplos reales que te doy. Prohibido el lenguaje genérico de empresa ("optimiza tu
  flujo de trabajo", "solución integral", "revoluciona", "lleva tu vida al siguiente nivel").
- No inventes cifras, precios, descuentos, premios, testimonios, integraciones ni funciones que no estén en los datos.
- Los chats deben sonar a WhatsApp real: frases cortas, la persona escribe natural (a veces sin tildes), Canix responde
  claro, con 1 emoji como máximo y confirmando la hora o el dato exacto. Máximo 120 caracteres por mensaje.
- No digas la dirección web en voz alta: di "Canix". La dirección aparece sola en el cierre.`;

export const VIDEO_RULES = `Eres el guionista de los videos de Canix, un asistente personal con IA que vive en WhatsApp.
${BASE_RULES}
- El gancho lo es todo: la primera escena ("hook") debe hacer que alguien siga mirando en 2 segundos (un problema
  cotidiano: se te olvidó un pago, una cita, el cumpleaños de tu mamá).
- Muestra, no cuentes: casi siempre hay al menos una escena "chat" con un ejemplo real.
- "text" es lo que se lee en pantalla: máximo 7 palabras, sin punto final.
- "say" es lo que dice la narradora: una o dos frases naturales que complementan lo que se ve (no leen el chat palabra
  por palabra). Máximo 35 palabras por escena. Números cortos en palabras.
- Entre 4 y 8 escenas. La primera es "hook" y la última es "end".

Responde SOLO con JSON: {"title": "título del video", "caption": "1 a 3 frases para publicar con el video, con 1 o 2
emojis y como máximo 3 hashtags específicos", "scenes": [{"shot": "...", "text": "...", "say": "...", "chat": [{"from":
"me" | "canix", "text": "...", "voice": false}], "items": ["..."]}]}`;

export const IMAGE_RULES = `Eres el redactor publicitario de Canix, un asistente personal con IA que vive en WhatsApp.
${BASE_RULES}
- La imagen se mira un segundo mientras la persona hace scroll: el titular la tiene que detener. Una sola idea, máximo
  6 palabras, sin punto final.
- "sub": una frase que completa el titular (qué es y para quién). Máximo 16 palabras.
- "bullets": exactamente tres beneficios reales, cada uno con un emoji al inicio y máximo 5 palabras.
- "cta": la acción, máximo 4 palabras ("Pide tu demo gratis", "Escríbele a Canix").
- "chat": 2 o 3 mensajes de ejemplo que respaldan el titular.
- "caption": 1 a 3 frases para publicar con la imagen, 1 o 2 emojis y como máximo 3 hashtags específicos.

Responde SOLO con JSON: {"title": "nombre interno corto", "headline": "...", "sub": "...", "bullets": ["...", "...",
"..."], "cta": "...", "caption": "...", "chat": [{"from": "me" | "canix", "text": "...", "voice": false}]}`;

function facts(feature: PromoFeature | undefined): string[] {
  const lines = [`- Producto: ${PRODUCT_FACTS}`, `- Funciones: ${FEATURES.map((f) => `${f.emoji} ${f.name}`).join(' · ')}`];
  if (feature) {
    lines.push(`- Función protagonista: ${feature.emoji} ${feature.name}. ${feature.facts}`);
    lines.push(`- Ejemplo de chat real: ${feature.chat.map((c) => `${c.from === 'me' ? 'Persona' : 'Canix'}: "${c.text}"`).join(' / ')}`);
  }
  return lines;
}

export function videoPrompt(kind: PromoKind, featureKey: string | null, idea: string, avoid: string[]): string {
  const lines = [`Haz ${GOALS[kind]}.`, '', 'Datos:', ...facts(featureByKey(featureKey)), '', 'Escenas disponibles:'];
  lines.push(...SHOTS.map((s) => `- ${s}: ${SHOT_HELP[s]}`));
  if (avoid.length) lines.push('', 'Ya hay videos con estos títulos: usa otro ángulo:', ...avoid.map((a) => `- ${a}`));
  if (idea) lines.push('', `Indicación del administrador (tenla muy en cuenta): ${idea}`);
  return lines.join('\n');
}

export function imagePrompt(kind: PromoKind, featureKey: string | null, layout: string, idea: string, avoid: string[]): string {
  const goal = { ad: 'una imagen publicitaria para que alguien pida la demo', howto: 'una imagen que explique en un vistazo cómo funciona Canix', feature: 'una imagen que muestre esta función con un ejemplo de chat' }[kind];
  const design = { chat: 'titular grande y un celular con el chat de WhatsApp', features: 'titular, tres beneficios y un chat pequeño', mascot: 'la mascota de Canix grande con el titular' }[layout] ?? '';
  const lines = [`Haz ${goal}.`, `Diseño: ${design}.`, '', 'Datos:', ...facts(featureByKey(featureKey))];
  if (avoid.length) lines.push('', 'Ya hay imágenes con estos titulares: escribe uno distinto:', ...avoid.map((a) => `- ${a}`));
  if (idea) lines.push('', `Indicación del administrador (tenla muy en cuenta): ${idea}`);
  return lines.join('\n');
}

// ---------- cleaning ----------

function short(value: unknown, limit: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).replace(/\s+\S*$/, '').replace(/[,;:]$/, '')}…`;
}

function cleanChat(raw: unknown, max = 4): ChatLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({ from: c.from === 'canix' ? 'canix' : 'me', text: short(c.text, MAX_LINE), ...(c.voice === true ? { voice: true } : {}) }) as ChatLine)
    .filter((c) => c.text)
    .slice(0, max);
}

function cleanItems(raw: unknown, max: number): string[] {
  return Array.isArray(raw) ? raw.map((x) => short(x, 40)).filter(Boolean).slice(0, max) : [];
}

export interface VideoScript {
  title: string;
  caption: string;
  scenes: PromoScene[];
}

/** Keeps only drawable scenes; guarantees hook first and end last. The template if almost nothing is left. */
export function cleanVideo(raw: unknown, fallback: VideoScript): VideoScript {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const scenes: PromoScene[] = [];
  for (const item of Array.isArray(s.scenes) ? s.scenes.slice(0, MAX_SCENES + 2) : []) {
    const x = (item ?? {}) as Record<string, unknown>;
    const shot = x.shot as PromoScene['shot'];
    const say = short(x.say, MAX_SAY);
    if (!SHOTS.includes(shot) || !say) continue;
    const scene: PromoScene = { shot, text: short(x.text, MAX_TEXT).replace(/\.$/, ''), say };
    if (shot === 'chat') {
      scene.chat = cleanChat(x.chat);
      if (scene.chat.length < 2) continue;
    }
    if (shot === 'features' || shot === 'steps') {
      scene.items = cleanItems(x.items, shot === 'steps' ? 3 : 6);
      if (scene.items.length < 3) continue;
    }
    scenes.push(scene);
  }
  if (scenes.length < 3) return fallback;
  if (scenes[0].shot !== 'hook') scenes.unshift(fallback.scenes[0]);
  if (scenes[scenes.length - 1].shot !== 'end') scenes.push(fallback.scenes[fallback.scenes.length - 1]);
  const kept = scenes.slice(0, MAX_SCENES);
  if (kept[kept.length - 1].shot !== 'end') kept[kept.length - 1] = fallback.scenes[fallback.scenes.length - 1];
  return { title: short(s.title, 90) || fallback.title, caption: short(s.caption, 400) || fallback.caption, scenes: kept };
}

export type ImageCopy = ImageContent & { title: string; caption: string };

export function cleanImage(raw: unknown, fallback: ImageCopy): ImageCopy {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bullets = cleanItems(s.bullets, 3);
  const chat = cleanChat(s.chat, 3);
  return {
    title: short(s.title, 90) || short(s.headline, 90) || fallback.title,
    headline: short(s.headline, 48).replace(/\.$/, '') || fallback.headline,
    sub: short(s.sub, 120) || fallback.sub,
    bullets: bullets.length === 3 ? bullets : fallback.bullets,
    cta: short(s.cta, 28).replace(/\.$/, '') || fallback.cta,
    caption: short(s.caption, 400) || fallback.caption,
    chat: chat.length >= 2 ? chat : fallback.chat,
  };
}

// ---------- fixed templates (no AI) ----------

const scene = (shot: PromoScene['shot'], text: string, say: string, extra: Partial<PromoScene> = {}): PromoScene => ({ shot, text, say, ...extra });
const END = scene('end', 'Canix', 'Canix: tu asistente personal en WhatsApp. Pide tu demo gratis.');
const STEPS = ['💬 Le escribes o le hablas', '🧠 Canix lo organiza', '⏰ Te avisa a tiempo'];

export function videoTemplate(kind: PromoKind, featureKey: string | null, variant = 0): VideoScript {
  const f = featureByKey(featureKey);
  if (kind === 'feature' && f) {
    return {
      title: `${f.name} con Canix`,
      caption: `${f.emoji} ${f.name} sin salir de WhatsApp: se lo pides a Canix como a un amigo. #canix #asistentepersonal`,
      scenes: [
        scene('hook', [`${f.name}, por WhatsApp`, `¿Y si nunca se te olvida?`][variant % 2], `¿Sabías que Canix se encarga de esto por ti? Te muestro cómo.`),
        scene('chat', 'Se lo pides con tus palabras', f.facts.split('. ')[0] + '.', { chat: f.chat }),
        scene('features', 'Y mucho más', 'Además recuerda, organiza y te avisa de todo lo demás.', { items: FEATURES.filter((x) => x.key !== f.key).slice(0, 4).map((x) => `${x.emoji} ${x.name}`) }),
        scene('cta', 'Pruébalo gratis', 'Pide tu demo gratis y escríbele hoy mismo.'),
        END,
      ],
    };
  }
  if (kind === 'howto') {
    return {
      title: 'Así funciona Canix',
      caption: 'Así funciona Canix en un minuto 💬 Le escribes, él lo organiza y te avisa a tiempo. #canix #productividad',
      scenes: [
        scene('hook', 'Así funciona Canix', 'Te muestro cómo funciona Canix, tu asistente personal en WhatsApp.'),
        scene('steps', 'Tan fácil como escribirle a un amigo', 'Le escribes o le mandas un audio, Canix lo organiza y te avisa a la hora exacta.', { items: STEPS }),
        scene('chat', 'Recordatorios con una frase', 'Entiende fechas, horas y repeticiones. Si le falta un dato, te pregunta.', { chat: featureByKey('reminders')!.chat }),
        scene('chat', '¿Qué tengo hoy?', 'Pregúntale por tu día y te lo da ordenado por hora.', { chat: featureByKey('agenda')!.chat }),
        scene('features', 'Todo en un solo chat', 'Rutinas, tareas, notas, citas y más, sin instalar nada.', { items: FEATURES.slice(2, 8).map((x) => `${x.emoji} ${x.name}`) }),
        scene('cta', 'Empieza con la demo gratis', 'Pide tu demo gratis: recibes un código, se lo mandas a Canix y listo.'),
        END,
      ],
    };
  }
  const hooks = ['¿Se te olvidó otra vez?', 'Tu asistente vive en WhatsApp', 'Deja de olvidar lo importante'];
  return {
    title: 'Canix: tu asistente en WhatsApp',
    caption: '¿Se te olvidan las cosas? Canix te las recuerda por WhatsApp ⏰ Pide tu demo gratis. #canix #asistentepersonal',
    scenes: [
      scene('hook', hooks[variant % hooks.length], '¿Se te pasó un pago, una cita o un cumpleaños? Eso se acabó.'),
      scene('chat', 'Se lo dices y listo', 'Le escribes a Canix como a un amigo y él se encarga.', { chat: featureByKey('reminders')!.chat }),
      scene('features', 'Un asistente para todo tu día', 'Recordatorios, rutinas, tareas, notas y citas, todo dentro de WhatsApp.', { items: FEATURES.slice(0, 6).map((x) => `${x.emoji} ${x.name}`) }),
      scene('cta', 'Pide tu demo gratis', 'Pruébalo gratis, sin tarjeta.'),
      END,
    ],
  };
}

export function imageTemplate(kind: PromoKind, featureKey: string | null, variant = 0): ImageCopy {
  const f = featureByKey(featureKey);
  if (kind === 'feature' && f) {
    const heads = [`${f.name} por WhatsApp`, 'Pídeselo como a un amigo', `${f.emoji} Canix se encarga`];
    return {
      title: heads[variant % heads.length], headline: heads[variant % heads.length],
      sub: f.facts.split('. ')[0] + '.', bullets: ['💬 Sin instalar nada', '🎤 Por texto o audio', '⏰ Te avisa a tiempo'], cta: 'Pide tu demo gratis',
      caption: `${f.emoji} ${f.name} sin salir de WhatsApp. Pruébalo gratis con Canix. #canix #asistentepersonal`, chat: f.chat,
    };
  }
  if (kind === 'howto') {
    const heads = ['Escríbele. Él se encarga', 'Así de fácil funciona', 'Como escribirle a un amigo'];
    return {
      title: heads[variant % heads.length], headline: heads[variant % heads.length],
      sub: 'Le escribes o le hablas por WhatsApp, Canix lo organiza y te avisa a tiempo.', bullets: STEPS, cta: 'Escríbele a Canix',
      caption: 'Así funciona Canix 💬 Le escribes, él lo organiza y te avisa a la hora exacta. #canix #productividad', chat: featureByKey('reminders')!.chat,
    };
  }
  const heads = ['¿Se te olvidó otra vez?', 'Tu asistente en WhatsApp', 'Nunca más olvides un pago'];
  return {
    title: heads[variant % heads.length], headline: heads[variant % heads.length],
    sub: 'Canix te recuerda lo importante, sostiene tus rutinas y organiza tu día desde WhatsApp.',
    bullets: ['⏰ Recordatorios a tiempo', '🔥 Rutinas con racha', '🎤 Le hablas por audio'], cta: 'Pide tu demo gratis',
    caption: '¿Se te olvidan las cosas? Canix te las recuerda por WhatsApp ⏰ Demo gratis, sin tarjeta. #canix #asistentepersonal',
    chat: featureByKey('agenda')!.chat,
  };
}
