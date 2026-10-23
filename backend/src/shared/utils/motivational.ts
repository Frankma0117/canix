/**
 * Rotating warm/motivational lead-ins for reminder text, picked at send time (not by the LLM) -
 * zero extra tokens, just makes "⏰ Revisar el horno" read like a friend nudging you instead of a
 * flat notification. Picked with Math.random(), no need to track which one was used last.
 */
function pick<T>(pool: readonly T[]): T {
  return pool[Math.floor(Math.random() * pool.length)];
}

// The rotating lead-ins that used to open every reminder ("Ojo con esto:", "Métele:", "Dale,
// arranca con:") were dropped at the user's request - they read as odd. A notice now opens with a
// fixed, plain label (see services/reminders/reminder-prompts.service.ts). These lists stay ONLY so messages stored
// with one of them baked in can still be cleaned up (stripKnownPrefix).
const RETIRED_FLEXIBLE_PREFIXES = ['🎲 Aprovecha y dale a:', '🌿 Un espacio para:', '🧘 Pausa para:', '✨ Cuando puedas hoy:', '🍃 Métele un rato a:'] as const;
const RETIRED_ROUTINE_PREFIXES = [
  '💪 Vamos, es hora de:', '🔥 Dale, arranca con:', '👊 A darle:', '⏰ Hora de:', '🌟 Toca:', '🏁 Arrancamos con:', '💥 Metámosle a:',
  'Vamos, es hora de:', 'Dale, arranca con:', 'A darle:', 'Hora de:', 'Toca:', 'Arrancamos con:', 'Metámosle a:',
] as const;

const IMPORTANT_DATE_PREFIXES = ['🎉', '🎊', '🥳', '📌', '🎈'] as const;

const IMPORTANT_DATE_NOTICE_PREFIXES = [
  '📅 Se viene:',
  '👀 Ojo que ya casi:',
  '🔔 Para que te vayas preparando:',
  '📣 En camino:',
] as const;


// Mirrors the (now-removed) automatic morning agenda's greeting, for the other end of the day -
// see services/agenda/agenda.service.ts's maybeNightFarewell(),
// fired from complete_todo/checkin_routine when finishing one of these was the LAST pending
// task/routine for today (and it's already late enough, see env.nightSummaryAfterHour) - the
// user's own "al hacer la última tarea, un mensaje y buenas noches" ask.
const NIGHT_OUTROS = [
  '🌙 ¡Buenas noches! Cerraste el día con todo hecho, descansa 💤',
  '🌌 ¡Buenas noches! No dejaste nada pendiente hoy, buen trabajo.',
  '😴 ¡Buenas noches! Día completo, a descansar.',
  '⭐ ¡Buenas noches! Todo listo por hoy, nos vemos mañana.',
] as const;

const WORKING_UPDATES = [
  '🕐 Sigo en eso, dame un momento más...',
  '⏳ Ya casi, estoy terminando de resolverlo...',
  '🔎 Dame unos segundos más, sigo trabajando en tu solicitud...',
  '🙏 Un poco más de paciencia, ya casi termino...',
] as const;

/** What a routine's notice row stores: just its title (the notice itself is built at send time). */
export function routineStartMessage(title: string): string {
  return title;
}

/** The written check-in, sent only when the notice went out without its poll. */
export function routineCheckinMessage(title: string): string {
  return `¿Ya hiciste "${title}"?`;
}

export function importantDateMessage(title: string): string {
  return `${pick(IMPORTANT_DATE_PREFIXES)} ${title}`;
}

export function importantDateNoticeMessage(title: string, advanceDays: number): string {
  return `📅 ${advanceDays === 1 ? 'Falta 1 día' : `Faltan ${advanceDays} días`}: ${title}`;
}

/** What a flexible reminder stores: the message as given. */
export function flexibleReminderMessage(message: string): string {
  return message;
}

export function nightFarewellMessage(): string {
  return pick(NIGHT_OUTROS);
}

/** "Still working on it" ping for a turn that's taking a while - see shared/utils/human-delay.ts's
 *  withWorkingUpdates(), which fires this on a timer while the AI loop is still running. */
export function workingUpdateMessage(): string {
  return pick(WORKING_UPDATES);
}

/**
 * Strips a leading randomly-picked prefix (important_date/important_date_notice/flexible - the
 * kinds whose prefix is baked into the stored `message` at creation time, unlike plain `reminder`)
 * so two functionally-identical reminders created at different times can be compared for
 * duplicates by their actual content (see services/maintenance/dedup.service.ts) instead of failing to match just because
 * each got a different random emoji prefix.
 */
export function stripKnownPrefix(text: string): string {
  const pools: readonly (readonly string[])[] = [IMPORTANT_DATE_PREFIXES, IMPORTANT_DATE_NOTICE_PREFIXES, RETIRED_FLEXIBLE_PREFIXES, RETIRED_ROUTINE_PREFIXES];
  for (const pool of pools) {
    for (const prefix of pool) {
      if (text.startsWith(prefix)) return text.slice(prefix.length).trim();
    }
  }
  return text.trim();
}
