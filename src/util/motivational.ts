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
