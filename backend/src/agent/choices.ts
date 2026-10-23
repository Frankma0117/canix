import { choicePromptsModel, type ChoiceOption } from '../models/choice-prompts.model.js';
import { nowLocal } from '../shared/utils/datetime.js';
import { footnote, reactionFooter } from '../shared/utils/wa-format.js';

/**
 * Quick answers to the bot's closed questions, without extra messages: a yes/no question is
 * answered by reacting to it (👍 / 👎), and a question with a few named options shows them
 * numbered inside the same message, answered with the number. Either way the answer is fed back
 * into the conversation as if the person had typed it, so every flow - the AI and the fixed
 * commands alike - behaves exactly as when answered in writing, which always stays possible.
 * (Polls were tried for this and dropped: one extra bulky message per question.)
 */
const MAX_OPTIONS = 9;
const MAX_LABEL = 60;
const NUMBER_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

export interface Choices {
  options: ChoiceOption[];
  binary: boolean;
  /** Answers are complete commands on their own: stays answerable while the chat moves on. */
  sticky?: boolean;
}

export const YES_NO: Choices = { options: [{ label: 'Sí', reply: 'sí' }, { label: 'No', reply: 'no' }], binary: true };

/** Yes/no answered by reaction, with what each reaction counts as (e.g. "confirmar cita 12"). */
export function yesNo(yesReply: string, noReply: string): Choices {
  return { options: [{ label: 'Sí', reply: yesReply }, { label: 'No', reply: noReply }], binary: true, sticky: true };
}

/**
 * Told to the model in every system prompt: how to mark a closed question so its options can be
 * answered quickly. Kept as one line the code strips before the person sees the message.
 */
export const CHOICES_RULE = `
- OPCIONES RÁPIDAS: cuando tu mensaje termine con una pregunta que se responde eligiendo entre 2 y 4
  opciones concretas (sí/no, "¿la dejo o miramos otra?", "¿hoy o mañana?", "¿A o B?"), agrega al
  FINAL del mensaje, en una línea aparte, exactamente: [[opciones: Opción 1 | Opción 2]] - con el
  texto corto (máximo 4 palabras) de lo que yo respondería en cada una, ej. [[opciones: Sí | No]] o
  [[opciones: Dejar esta | Ver otra]]. El sistema se encarga de mostrármelas (con 👍/👎 o con
  números) - tú NO las numeres ni las repitas en el texto. NO lo pongas en preguntas abiertas (una
  hora, una fecha, un nombre, un texto) ni cuando no estés preguntando nada. Nunca menciones esa
  línea ni la expliques.`;

/**
 * Told to the model in every system prompt: how a message must look on WhatsApp. toWhatsApp()
 * (shared/utils/wa-format.ts) still cleans up whatever Markdown slips through.
 */
export const STYLE_RULE = `
- FORMATO DE WHATSAPP (así se ven bien mis mensajes): negrilla con UN solo asterisco (*así*), nunca
  con dos (**así no**); nada de "#" para títulos, ni tablas, ni líneas "---". Listas con "- " al
  inicio de la línea. Mensajes cortos y con aire: una idea por bloque, una línea en blanco entre
  bloques, y un título corto en negrilla con un emoji cuando haya varias partes. Si una lista pasa de
  8 elementos, muestra los más importantes y resume el resto ("y 5 más"). Las horas escríbelas
  cortas y entre comillas invertidas, así: \`5:00 pm\`. No repitas en el texto lo que ya dice una
  lista, ni abras con frases de relleno. Si listas cosas de mi día, sepáralas en bloques con título
  ("🔴 *Sin marcar*", "🟢 *Marcadas*", "🔵 *Lo que viene*") en vez de repetir un aviso en cada fila.
- Cuando una tool te devuelva un texto ya diseñado (empieza con un título en negrilla con emoji: el
  menú, la agenda de un día, el resumen semanal, la lista de voces y todas las listas - links,
  contactos, notas, listas, recordatorios, pendientes, categorías, comidas, recetas), mándamelo TAL
  CUAL, completo, sin reescribirlo, reordenarlo ni resumirlo, y sin quitarle las marcas ⟦12⟧; a lo
  sumo agrega UNA línea corta al final. Si solo usaste la lista para buscar un dato y responderme
  algo puntual, responde eso y no mandes la lista.
- Las marcas ⟦12⟧ son los ids internos de cada cosa: úsalas para editar o borrar la correcta, pero
  yo nunca las veo (el sistema las quita al enviar). NUNCA me escribas ids ni números tipo "#12" en
  tus propias palabras ni me pidas un número de id: nombra las cosas por su nombre y, si hay varias
  parecidas, pregúntame cuál por su nombre, hora o fecha.
- NUNCA escribas de memoria una lista con ese formato ni inventes sus filas: para mostrarme
  recordatorios, links, contactos, notas, listas o pendientes SIEMPRE llama la tool en ese mismo
  turno y manda lo que devuelva. Si no llamaste la tool, no tienes la lista.
- Para "qué tengo mañana / el viernes / ayer" usa get_today_agenda con date (misma vista que hoy).
- Un link suelto va con su título en negrilla y la dirección sola en la línea de abajo.`;

const MARKER_RE = /\[\[\s*opci[oó]n(?:es)?\s*:\s*([^\]]*)\]\]/gi;

function cleanLabel(raw: string): string {
  return raw.replace(/[*_~`"“”]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
}

const norm = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
const isYes = (label: string) => /^(si|sip|claro|dale|ok|de una)\b/.test(norm(label));
const isNo = (label: string) => /^(no|nop|todavia no|aun no)\b/.test(norm(label));

// A closed yes/no question the model forgot to mark: starts like an offer/confirmation and has
// neither an "o" alternative nor an open-ended question word.
const YES_NO_START_RE = /^¿\s*(quieres|quer[eé]s|deseas|te (gustar[ií]a|parece|sirve|lo|la|los|las|aviso|recuerdo|agendo|programo|ayudo)|l[oa]s? (dejo|guardo|agendo|programo|creo|borro|elimino|cambio|cancelo|confirmo|marco|muevo)|confirm[ao]s?|est[aá]s? segur[oa]|est[aá] bien|seguimos|procedo|as[ií] est[aá] bien|de acuerdo)\b/i;
// Accented forms only: unaccented "que"/"como"/"cuando" are ordinary connectors ("¿quieres que...?").
const OPEN_WORD_RE = /(^|[\s¿])(qué|cuál(es)?|cuándo|cuánt[oa]s?|cómo|dónde|quién(es)?)(?=[\s?,]|$)/i;

function inferYesNo(text: string): Choices | null {
  const last = text.trim().split('\n').pop() ?? '';
  const start = last.lastIndexOf('¿');
  if (start < 0 || !/\?\s*(\p{Extended_Pictographic}|\s)*$/u.test(last)) return null;
  const question = last.slice(start);
  if (!YES_NO_START_RE.test(question)) return null;
  if (/\so\s/i.test(question) || OPEN_WORD_RE.test(question.slice(1))) return null;
  return YES_NO;
}

/**
 * Splits a reply into the text to show and the quick answers to offer with it: the model's own
 * [[opciones: ...]] line when present (always removed from the text), otherwise yes/no when the
 * message plainly ends in a yes/no question. `choices` is null when there's nothing to choose.
 */
export function splitChoices(reply: string): { text: string; choices: Choices | null } {
  let marked: string | null = null;
  const text = reply
    .replace(MARKER_RE, (_m, inner: string) => {
      marked = inner;
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (marked === null) return { text, choices: inferYesNo(text) };
  const labels = [...new Set((marked as string).split('|').map(cleanLabel).filter(Boolean))];
  if (labels.length < 2 || labels.length > MAX_OPTIONS) return { text, choices: null };
  if (labels.length === 2 && isYes(labels[0]) && isNo(labels[1])) return { text, choices: YES_NO };
  if (labels.length === 2 && isNo(labels[0]) && isYes(labels[1])) return { text, choices: YES_NO };
  return { text, choices: { options: labels.map((label) => ({ label, reply: label })), binary: false } };
}

/**
 * Options only make sense under a question. The model sometimes tacks an options marker onto a
 * reply that asks nothing - seen on a list of reminders, which went out ending in "1 Ese horario /
 * 2 Otro horario" left over from an earlier turn - so they're kept only when what's actually
 * being sent closes with a question.
 */
export function choicesFor(text: string, choices: Choices | null): Choices | null {
  if (!choices) return null;
  const lines = text.split(String.fromCharCode(10)).map((l) => l.trim()).filter((l) => l && !l.startsWith('>'));
  const closing = lines.slice(-2).join(' ');
  return closing.includes('?') ? choices : null;
}

/** Removes the options line - for what gets stored as the conversation and read aloud. */
export function stripChoices(reply: string): string {
  return splitChoices(reply).text;
}

/** What goes under a question saying how to answer it quickly: the instruction, then the options. */
export function choicesHint(choices: Choices): string {
  if (choices.binary) return reactionFooter();
  return footnote('Responde con el número', ...choices.options.map((o, i) => `${NUMBER_EMOJI[i] ?? `${i + 1}.`} ${o.label}`));
}

/** The message as it goes out: the question followed by its quick-answer hint. */
export function withChoices(text: string, choices: Choices | null): string {
  return choices ? `${text}\n\n${choicesHint(choices)}` : text;
}

/** Remembers that `msgId` is a question waiting for one of these answers, replacing any earlier one. */
export function registerChoices(userId: number, msgId: string | null, choices: Choices): void {
  if (!msgId) return;
  if (!choices.sticky) choicePromptsModel.closeOpenFor(userId);
  choicePromptsModel.create(userId, msgId, choices.options, { binary: choices.binary, sticky: !!choices.sticky }, nowLocal());
}

// Skin-tone modifiers and the variation selector ride along with the base emoji.
const baseEmoji = (emoji: string) => emoji.replace(/[\u{1F3FB}-\u{1F3FF}️]/gu, '');
const YES_REACTIONS = new Set(['👍', '✅', '✔', '👌', '💪', '🙌', '👏', '🔥', '💯', '❤', '🫡', '🙏']);
const NO_REACTIONS = new Set(['👎', '❌', '✖', '🚫', '😢', '😞', '😔']);

/** What a reaction means as an answer: 'yes', 'no', or null for anything else (😂, removed...). */
export function reactionAnswer(emoji: string | null | undefined): 'yes' | 'no' | null {
  const e = baseEmoji(emoji ?? '');
  if (YES_REACTIONS.has(e)) return 'yes';
  if (NO_REACTIONS.has(e)) return 'no';
  return null;
}

/**
 * A 👍/👎 on one of the bot's questions. Returns the text it counts as, 'stale' when that question
 * is no longer the one waiting (the conversation moved on), or null when the message isn't a
 * yes/no question of ours at all.
 */
export function replyForReaction(userId: number, msgId: string, answer: 'yes' | 'no'): string | 'stale' | null {
  const prompt = choicePromptsModel.findByMessageId(userId, msgId);
  if (!prompt || !prompt.binary || prompt.options.length < 2) return null;
  const reply = prompt.options[answer === 'yes' ? 0 : 1].reply;
  if (!reply) return null; // that reaction has no meaning for this message (e.g. only 👎 undoes)
  if (prompt.status !== 'open') return 'stale';
  if (prompt.sticky) choicePromptsModel.close(prompt.id);
  else choicePromptsModel.closeOpenFor(userId);
  return reply;
}

/** "2" typed while a numbered question is waiting -> that option's text; null otherwise. */
export function replyForNumber(userId: number, text: string): string | null {
  const m = /^\s*(\d{1,2})\s*[.)]?\s*$/.exec(text);
  if (!m) return null;
  const prompt = choicePromptsModel.openFor(userId);
  if (!prompt || prompt.binary) return null;
  return prompt.options[Number(m[1]) - 1]?.reply ?? null;
}
