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
] as const;

const ROUTINE_START_PREFIXES = ['💪 Vamos, es hora de:', '🔥 Dale, arranca con:', '👊 A darle:', '⏰ Hora de:'] as const;

const ROUTINE_CHECKIN_TEMPLATES = [
  (title: string) => `✅ ¿Cómo te fue con "${title}"? Cuéntame para sumarlo a tu racha 🔥`,
  (title: string) => `🙌 ¿Lograste "${title}"? Avísame y lo dejamos registrado.`,
  (title: string) => `💪 ¿Cumpliste con "${title}"? Cuéntame, así seguimos sumando racha.`,
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
