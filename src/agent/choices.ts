import { choicePromptsRepo, type ChoiceOption } from '../db/repositories/choice-prompts.repo.js';
import { nowLocal } from '../util/datetime.js';

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
const NUMBER_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

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

/** Removes the options line - for what gets stored as the conversation and read aloud. */
export function stripChoices(reply: string): string {
  return splitChoices(reply).text;
}

/** The line added under a question saying how to answer it quickly. */
export function choicesHint(choices: Choices): string {
  if (choices.binary) return '_👍 sí  ·  👎 no_';
  return `${choices.options.map((o, i) => `${NUMBER_EMOJI[i]} ${o.label}`).join('\n')}\n_Responde con el número._`;
}

/** The message as it goes out: the question followed by its quick-answer hint. */
export function withChoices(text: string, choices: Choices | null): string {
  return choices ? `${text}\n\n${choicesHint(choices)}` : text;
}

/** Remembers that `msgId` is a question waiting for one of these answers, replacing any earlier one. */
export function registerChoices(userId: number, msgId: string | null, choices: Choices): void {
  if (!msgId) return;
  if (!choices.sticky) choicePromptsRepo.closeOpenFor(userId);
  choicePromptsRepo.create(userId, msgId, choices.options, { binary: choices.binary, sticky: !!choices.sticky }, nowLocal());
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
  const prompt = choicePromptsRepo.findByMessageId(userId, msgId);
  if (!prompt || !prompt.binary || prompt.options.length < 2) return null;
  if (prompt.status !== 'open') return 'stale';
  if (prompt.sticky) choicePromptsRepo.close(prompt.id);
  else choicePromptsRepo.closeOpenFor(userId);
  return prompt.options[answer === 'yes' ? 0 : 1].reply;
}

/** "2" typed while a numbered question is waiting -> that option's text; null otherwise. */
export function replyForNumber(userId: number, text: string): string | null {
  const m = /^\s*([1-9])\s*[.)]?\s*$/.exec(text);
  if (!m) return null;
  const prompt = choicePromptsRepo.openFor(userId);
  if (!prompt || prompt.binary) return null;
  return prompt.options[Number(m[1]) - 1]?.reply ?? null;
}
