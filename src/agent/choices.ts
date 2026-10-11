import { createHash, randomBytes } from 'node:crypto';
import { choicePollsRepo, type ChoiceOption } from '../db/repositories/choice-polls.repo.js';
import { nowLocal } from '../util/datetime.js';

/**
 * Tappable answers for the bot's closed questions ("¿la dejo o miramos otra?"). WhatsApp gives
 * real buttons only to Business API accounts, so the options go out as a single-choice poll right
 * under the question (same mechanism as the Sí/No of reminders, see agent/reminder-prompts.ts).
 * A tap is fed back into the conversation as if the person had typed that option, so every flow -
 * the AI and the fixed commands alike - keeps working exactly as when answered in writing, which
 * also stays possible.
 */

/** WhatsApp allows up to 12 options in a poll - a longer list goes out as several polls. */
const MAX_OPTIONS = 12;
const MAX_LABEL = 60;

export const YES_NO: ChoiceOption[] = [
  { label: '✅ Sí', reply: 'sí' },
  { label: '❌ No', reply: 'no' },
];

/**
 * Told to the model in every system prompt: how to mark a closed question so its options become
 * tappable. Kept as one line the code strips before the person sees the message.
 */
export const CHOICES_RULE = `
- OPCIONES PARA TOCAR: cuando tu mensaje termine con una pregunta que se responde eligiendo entre 2
  y 4 opciones concretas (sí/no, "¿la dejo o miramos otra?", "¿hoy o mañana?", "¿A o B?"), agrega al
  FINAL del mensaje, en una línea aparte, exactamente: [[opciones: Opción 1 | Opción 2]] - con el
  texto corto (máximo 4 palabras) de lo que yo respondería en cada una, ej. [[opciones: Sí | No]] o
  [[opciones: Dejar esta | Ver otra]]. Yo las veo como botones para tocar. NO lo pongas en preguntas
  abiertas (una hora, una fecha, un nombre, un texto) ni cuando no estés preguntando nada. Nunca
  menciones esa línea ni la expliques.`;

const MARKER_RE = /\[\[\s*opci[oó]n(?:es)?\s*:\s*([^\]]*)\]\]/gi;

function cleanLabel(raw: string): string {
  return raw.replace(/[*_~`"“”]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
}

/** Options given by hand: ['Sí', 'No'] - each one is its own typed reply. */
export function plainOptions(labels: string[]): ChoiceOption[] {
  return labels.map((label) => ({ label, reply: label }));
}

// A closed yes/no question the model forgot to mark: starts like an offer/confirmation and has
// neither an "o" alternative nor an open-ended question word.
const YES_NO_START_RE = /^¿\s*(quieres|quer[eé]s|deseas|te (gustar[ií]a|parece|sirve|lo|la|los|las|aviso|recuerdo|agendo|programo|ayudo)|l[oa]s? (dejo|guardo|agendo|programo|creo|borro|elimino|cambio|cancelo|confirmo|marco|muevo)|confirm[ao]s?|est[aá]s? segur[oa]|est[aá] bien|seguimos|procedo|as[ií] est[aá] bien|de acuerdo)\b/i;
// Accented forms only: unaccented "que"/"como"/"cuando" are ordinary connectors ("¿quieres que...?").
const OPEN_WORD_RE = /(^|[\s¿])(qué|cuál(es)?|cuándo|cuánt[oa]s?|cómo|dónde|quién(es)?)(?=[\s?,]|$)/i;

function inferYesNo(text: string): ChoiceOption[] | null {
  const last = text.trim().split('\n').pop() ?? '';
  const start = last.lastIndexOf('¿');
  if (start < 0 || !/\?\s*(\p{Extended_Pictographic}|\s)*$/u.test(last)) return null;
  const question = last.slice(start);
  if (!YES_NO_START_RE.test(question)) return null;
  if (/\so\s/i.test(question) || OPEN_WORD_RE.test(question.slice(1))) return null;
  return YES_NO;
}

/**
 * Splits a reply into the text to show and the options to offer under it: the model's own
 * [[opciones: ...]] line when present (always removed from the text), otherwise Sí/No when the
 * message plainly ends in a yes/no question. `options` is null when there's nothing to tap.
 */
export function splitChoices(reply: string): { text: string; options: ChoiceOption[] | null } {
  let marked: string | null = null;
  const text = reply
    .replace(MARKER_RE, (_m, inner: string) => {
      marked = inner;
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (marked !== null) {
    const labels = [...new Set((marked as string).split('|').map(cleanLabel).filter(Boolean))];
    if (labels.length >= 2 && labels.length <= MAX_OPTIONS) return { text, options: plainOptions(labels) };
    return { text, options: null };
  }
  return { text, options: inferYesNo(text) };
}

/** Removes the options line - for what gets stored as the conversation and read aloud. */
export function stripChoices(reply: string): string {
  return splitChoices(reply).text;
}

interface PollSender {
  sendPoll(jid: string, question: string, options: string[], secret: Uint8Array): Promise<string | null>;
}

/**
 * Sends the options as a poll (several, when there are more than fit in one) and remembers them,
 * replacing whatever earlier question was still waiting. Best-effort: the question already went
 * out as text and can be answered in writing, so a poll that fails to send only logs. Returns
 * whether anything went out.
 */
export async function sendChoices(wa: PollSender, userId: number, jid: string, options: ChoiceOption[], title = 'Toca tu respuesta 👇'): Promise<boolean> {
  const unique = options.filter((o, i) => o.label && options.findIndex((x) => x.label === o.label) === i);
  if (unique.length < 2) return false;
  // Never leave a lone option in the last poll (a poll needs two).
  const size = unique.length % MAX_OPTIONS === 1 ? MAX_OPTIONS - 1 : MAX_OPTIONS;
  let sent = false;
  try {
    for (let i = 0; i < unique.length; i += size) {
      const chunk = unique.slice(i, i + size);
      const secret = randomBytes(32);
      const pollMsgId = await wa.sendPoll(jid, i === 0 ? title : 'Más opciones 👇', chunk.map((o) => o.label), secret);
      if (!pollMsgId) break;
      if (!sent) choicePollsRepo.closeOpenFor(userId);
      choicePollsRepo.create(userId, pollMsgId, secret, chunk, nowLocal());
      sent = true;
    }
  } catch (err) {
    console.error('[CHOICES] No se pudieron enviar las opciones a %s:', jid, (err as Error).message);
  }
  return sent;
}

/** Which option a decrypted vote (hex sha256 of each selected option) points at. */
export function optionFromVote(options: ChoiceOption[], selectedHashes: string[]): ChoiceOption | undefined {
  return options.find((o) => selectedHashes.includes(createHash('sha256').update(o.label).digest('hex')));
}
