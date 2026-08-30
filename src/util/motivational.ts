/**
 * Rotating warm/motivational lead-ins for reminder text, picked at send time (not by the LLM) -
 * zero extra tokens, just makes "⏰ Revisar el horno" read like a friend nudging you instead of a
 * flat notification. Picked with Math.random(), no need to track which one was used last.
 */
function pick<T>(pool: readonly T[]): T {
  return pool[Math.floor(Math.random() * pool.length)];
}

const PLAIN_REMINDER_PREFIXES = [
  '⏰ Recuerda:',
  '💪 Dale, no se te olvide:',
  '🙌 Ojo, toca:',
  '🔥 Vamos, es hora de:',
  '✨ No lo dejes pasar:',
  '👊 Métele:',
  '📣 Aviso importante:',
  '🚨 Ojo con esto:',
  '🧠 Para que no se te pase:',
  '🙏 Un empujoncito:',
  '⚡ Va rapidito, pero toca:',
  '🎯 Enfócate un momento en esto:',
] as const;

const ROUTINE_START_PREFIXES = [
  '💪 Vamos, es hora de:',
  '🔥 Dale, arranca con:',
  '👊 A darle:',
  '⏰ Hora de:',
  '🌟 Toca:',
  '🏁 Arrancamos con:',
  '💥 Metámosle a:',
] as const;

const ROUTINE_CHECKIN_TEMPLATES = [
  (title: string) => `✅ ¿Cómo te fue con "${title}"? Cuéntame para sumarlo a tu racha 🔥`,
  (title: string) => `🙌 ¿Lograste "${title}"? Avísame y lo dejamos registrado.`,
  (title: string) => `💪 ¿Cumpliste con "${title}"? Cuéntame, así seguimos sumando racha.`,
  (title: string) => `📝 Cuéntame de "${title}" - ¿quedó hecho o lo movemos para otro rato?`,
  (title: string) => `🔥 No dejes fría la racha - ¿"${title}" quedó listo?`,
] as const;

const IMPORTANT_DATE_PREFIXES = ['🎉', '🎊', '🥳', '📌', '🎈'] as const;

const IMPORTANT_DATE_NOTICE_PREFIXES = [
  '📅 Se viene:',
  '👀 Ojo que ya casi:',
  '🔔 Para que te vayas preparando:',
  '📣 En camino:',
] as const;

const FLEXIBLE_PREFIXES = [
  '🎲 Aprovecha y dale a:',
  '🌿 Un espacio para:',
  '🧘 Pausa para:',
  '✨ Cuando puedas hoy:',
  '🍃 Métele un rato a:',
] as const;

// Every variant explicitly says "Buenos días" - the user's own ask: the automatic morning agenda
// (kind: 'daily_agenda', see task-scheduler.ts) should always greet with it, not just sometimes
// happen to (the old pool had "Vamos con toda la energía hoy" with no greeting at all in it).
const AGENDA_INTROS = [
  '🌞 ¡Buenos días! Vamos con todo hoy.',
  '☕ ¡Buenos días! Arrancando el día - esto es lo tuyo:',
  '🙌 ¡Buenos días! Nuevo día, nueva oportunidad de cumplir todo:',
  '💪 ¡Buenos días! A darle - así se ve tu día:',
  '✨ ¡Buenos días! Aquí va lo que tienes:',
  '🔥 ¡Buenos días! Vamos con toda la energía hoy:',
] as const;

// Mirrors AGENDA_INTROS for the other end of the day - see agent/agenda.ts's maybeNightFarewell(),
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

export function plainReminderPrefix(): string {
  return pick(PLAIN_REMINDER_PREFIXES);
}

export function routineStartMessage(title: string): string {
  return `${pick(ROUTINE_START_PREFIXES)} ${title}`;
}

export function routineCheckinMessage(title: string): string {
  return pick(ROUTINE_CHECKIN_TEMPLATES)(title);
}

export function importantDateMessage(title: string): string {
  return `${pick(IMPORTANT_DATE_PREFIXES)} ${title}`;
}

export function importantDateNoticeMessage(title: string, advanceDays: number): string {
  return `${pick(IMPORTANT_DATE_NOTICE_PREFIXES)} en ${advanceDays} día(s), ${title}`;
}

export function flexibleReminderMessage(message: string): string {
  return `${pick(FLEXIBLE_PREFIXES)} ${message}`;
}

export function dailyAgendaIntro(): string {
  return pick(AGENDA_INTROS);
}

export function nightFarewellMessage(): string {
  return pick(NIGHT_OUTROS);
}

/** "Still working on it" ping for a turn that's taking a while - see util/human-delay.ts's
 *  withWorkingUpdates(), which fires this on a timer while the AI loop is still running. */
export function workingUpdateMessage(): string {
  return pick(WORKING_UPDATES);
}

/**
 * Strips a leading randomly-picked prefix (important_date/important_date_notice/flexible - the
 * kinds whose prefix is baked into the stored `message` at creation time, unlike plain `reminder`)
 * so two functionally-identical reminders created at different times can be compared for
 * duplicates by their actual content (see agent/dedup.ts) instead of failing to match just because
 * each got a different random emoji prefix.
 */
export function stripKnownPrefix(text: string): string {
  const pools: readonly (readonly string[])[] = [IMPORTANT_DATE_PREFIXES, IMPORTANT_DATE_NOTICE_PREFIXES, FLEXIBLE_PREFIXES];
  for (const pool of pools) {
    for (const prefix of pool) {
      if (text.startsWith(prefix)) return text.slice(prefix.length).trim();
    }
  }
  return text.trim();
}
