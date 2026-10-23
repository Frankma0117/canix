import { medicationsModel, type MedicationFields } from '../../models/medications.model.js';
import { remindersModel } from '../../models/reminders.model.js';
import { reminderPromptsModel } from '../../models/reminder-prompts.model.js';
import { usersModel } from '../../models/users.model.js';
import { addDays, nowLocal, parseWall, todayLocal } from '../../shared/utils/datetime.js';
import { normalizeTimes } from '../../shared/utils/clock-times.js';
import { progressBar } from '../../shared/utils/wa-format.js';
import type { Medication, MedicationKind, PromptAnswer, PromptSource, Reminder } from '../../entities/index.js';

/**
 * Medicines, vitamins, supplements, creams, skincare and water taken on a schedule. A medication owns one
 * reminder per daily time (kind 'medication'); the scheduler sends "💊 Toca tomar…" with the
 * 👍/👎 footer, and every answer is kept per dose (reminder_prompts.medication_id) - that is the
 * adherence history. Editing a medication rebuilds its reminders; pausing removes them; finishing a
 * treatment (end_date) stops them on their own. Water (kind 'water') works the same, but its notice
 * says "💧 Hora de tomar agua" with the day's progress, and every 👍 / "ya me tomé un vaso" is one
 * more glass toward the goal (one per notice time) - see dayProgress().
 */

export const MEDICATION_KINDS: Record<MedicationKind, { label: string; emoji: string; verb: string }> = {
  medicine: { label: 'Medicamento', emoji: '💊', verb: 'tomar' },
  vitamin: { label: 'Vitamina', emoji: '🍊', verb: 'tomar' },
  supplement: { label: 'Suplemento', emoji: '🥤', verb: 'tomar' },
  cream: { label: 'Crema', emoji: '🧴', verb: 'aplicar' },
  skincare: { label: 'Skincare', emoji: '✨', verb: 'aplicar' },
  water: { label: 'Agua', emoji: '💧', verb: 'tomar agua' },
  bodycare: { label: 'Cuidado corporal', emoji: '🩱', verb: 'ponerte' },
  other: { label: 'Otro', emoji: '🔔', verb: 'usar' },
};

export function isMedicationKind(value: unknown): value is MedicationKind {
  return typeof value === 'string' && value in MEDICATION_KINDS;
}

/**
 * "cada 8 horas desde las 6" -> 06:00, 14:00, 22:00. With `until` the times stop there instead of
 * going around the clock: water "cada 2 horas de 8am a 8pm" -> 08:00, 10:00 … 20:00.
 */
export function timesEvery(hours: number, first: string, until?: string): string[] {
  const start = normalizeTimes([first])[0];
  if (!start || !Number.isFinite(hours) || hours < 0.5 || hours > 24) return start ? [start] : [];
  const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const from = toMinutes(start);
  const end = until ? normalizeTimes([until])[0] : undefined;
  const last = end ? (toMinutes(end) >= from ? toMinutes(end) : toMinutes(end) + 24 * 60) : from + 24 * 60 - 1;
  const step = Math.round(hours * 60);
  const out: string[] = [];
  for (let minutes = from; minutes <= last; minutes += step) {
    const t = minutes % (24 * 60);
    out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  }
  return normalizeTimes(out);
}

export function timesOf(med: Pick<Medication, 'times'>): string[] {
  try {
    return normalizeTimes(JSON.parse(med.times));
  } catch {
    return [];
  }
}

function weekdaysOf(med: Pick<Medication, 'weekdays'>): number[] {
  return med.weekdays ? med.weekdays.split(',').map(Number).filter((d) => d >= 0 && d <= 6) : [];
}

/** True when a dose is due on that day: inside start/end and on one of its weekdays. */
export function dueOn(med: Medication, date: string): boolean {
  if (med.start_date && date < med.start_date) return false;
  if (med.end_date && date > med.end_date) return false;
  const days = weekdaysOf(med);
  return days.length === 0 || days.includes(parseWall(`${date} 12:00:00`).getUTCDay());
}

/** The first 'YYYY-MM-DD HH:mm:00' at `time` strictly after `after`, on a day the medication is due; null when the treatment is over. */
function nextDoseAt(med: Medication, time: string, after: string): string | null {
  let date = after.slice(0, 10);
  for (let i = 0; i < 400; i++) {
    const at = `${date} ${time}:00`;
    if (at > after && dueOn(med, date)) return at;
    if (med.end_date && date > med.end_date) return null;
    date = addDays(date, 1).slice(0, 10);
  }
  return null;
}

/** Next run of a medication reminder after it fired (used by the scheduler); undefined = done. */
export function nextMedicationRunAt(reminder: Pick<Reminder, 'medication_id' | 'run_at'>): string | undefined {
  if (!reminder.medication_id) return undefined;
  const med = medicationsModel.getByIdUnscoped(reminder.medication_id);
  if (!med || !med.active) return undefined;
  return nextDoseAt(med, reminder.run_at.slice(11, 16), reminder.run_at) ?? undefined;
}

/** Rebuilds a medication's reminders from its times and schedule (none while paused or finished). */
export function syncMedicationReminders(userId: number, medicationId: number): number {
  remindersModel.removeOwnedBy({ medicationId });
  const med = medicationsModel.getById(userId, medicationId);
  const owner = usersModel.getById(userId);
  if (!med || !med.active || !owner) return 0;
  const now = nowLocal();
  let created = 0;
  for (const time of timesOf(med)) {
    const runAt = nextDoseAt(med, time, now);
    if (!runAt) continue;
    remindersModel.create(userId, {
      message: med.name,
      runAt,
      targetJid: owner.jid,
      categoryId: null,
      recurrenceFreq: 'daily',
      recurrenceInterval: 1,
      kind: 'medication',
      medicationId: med.id,
    });
    created++;
  }
  return created;
}

export function createMedication(userId: number, fields: MedicationFields & { name: string; times: string[] }): Medication {
  const id = medicationsModel.create(userId, fields);
  syncMedicationReminders(userId, id);
  return medicationsModel.getById(userId, id)!;
}

export function updateMedication(userId: number, id: number, fields: MedicationFields): Medication | undefined {
  if (!medicationsModel.getById(userId, id)) return undefined;
  medicationsModel.update(userId, id, fields);
  syncMedicationReminders(userId, id);
  return medicationsModel.getById(userId, id);
}

/** "💊 Vitamina D · 1 cápsula · con el desayuno" */
export function describeMedication(med: Medication): string {
  const kind = MEDICATION_KINDS[med.kind] ?? MEDICATION_KINDS.other;
  return [`${kind.emoji} ${med.name}`, med.dose, med.instructions].filter(Boolean).join(' · ');
}

const ACTION_RE = /^(poner|quitar|usar|cambiar|aplicar|tomar|hacer|lavar|masajear|estirar|colocar|retirar)(me|te|se)?\b/i;

/** "Ponerme la faja" -> "*ponerte la faja*"; null when the name isn't an action. */
function actionText(name: string): string | null {
  const clean = name.replace(/\*/g, '').trim();
  const m = clean.match(ACTION_RE);
  if (!m) return null;
  const verb = m[1].toLowerCase() + (m[2] ? 'te' : '');
  return `*${verb}${clean.slice(m[0].length)}*`;
}

/** Glasses / doses marked taken on `date` against how many are due that day (its notice times). */
export function dayProgress(med: Medication, date: string = todayLocal()): { done: number; goal: number } {
  const done = reminderPromptsModel.listForMedication(med.id, date).filter((p) => p.occurrence_date === date && p.answer === 'yes').length;
  return { done, goal: dueOn(med, date) ? timesOf(med).length : 0 };
}

/** "Vas 3 de 7 vasos hoy ▰▰▰▰▱▱▱▱▱▱" */
export function waterProgressLine(med: Medication, date?: string): string {
  const { done, goal } = dayProgress(med, date);
  return done >= goal && goal > 0 ? `¡Meta cumplida! ${done} de ${goal} vasos 🎉` : `Vas ${done} de ${goal} vasos hoy ${progressBar(done, goal)}`;
}

/** The notice text of a dose. */
export function medicationNotice(med: Medication): string {
  if (med.kind === 'water') {
    const named = med.name.trim().toLowerCase() === 'agua' ? '' : `\n*${med.name.replace(/\*/g, '')}*`;
    return `💧 Hora de tomar agua${named}${med.dose ? `\n${med.dose}` : ''}\n> ${waterProgressLine(med)}`;
  }
  const kind = MEDICATION_KINDS[med.kind] ?? MEDICATION_KINDS.other;
  const details = [med.dose, med.instructions].filter(Boolean).join(' · ');
  const until = med.end_date ? `\n> Tratamiento hasta el ${med.end_date}` : '';
  // Named by the action ("Ponerme la faja", "Quitarme la faja"): the notice says just that.
  const action = actionText(med.name);
  if (action) return `${kind.emoji} Toca ${action}${details ? `\n${details}` : ''}${until}`;
  return `${kind.emoji} Toca ${kind.verb}\n*${med.name.replace(/\*/g, '')}*${details ? `\n${details}` : ''}${until}`;
}

/** Marks today's (or `date`'s) dose as taken / not taken - from chat or the portal. */
export function logMedicationAnswer(userId: number, med: Medication, date: string, taken: boolean, source: PromptSource): void {
  const answer: PromptAnswer = taken ? 'yes' : 'no';
  const doses = reminderPromptsModel.listForMedication(med.id, date).filter((p) => p.occurrence_date === date);
  // Water: once every notice of the day is answered, one more glass is one more dose.
  const open = doses.find((p) => p.answer === null) ?? (med.kind === 'water' && taken ? undefined : doses[doses.length - 1]);
  const prompt =
    open ?? reminderPromptsModel.create({ userId, reminderId: null, todoId: null, medicationId: med.id, title: med.name, occurrenceDate: date, sentAt: null });
  if (prompt.answer !== answer) reminderPromptsModel.setAnswer(prompt.id, answer, source, nowLocal());
}

/** Last `days` days of doses: how many were due (notices sent or marked) and how many taken. */
export function adherence(med: Medication, days = 7): { taken: number; missed: number; pending: number } {
  const from = addDays(todayLocal(), -(days - 1)).slice(0, 10);
  const doses = reminderPromptsModel.listForMedication(med.id, from);
  return {
    taken: doses.filter((d) => d.answer === 'yes').length,
    missed: doses.filter((d) => d.answer === 'no').length,
    pending: doses.filter((d) => d.answer === null).length,
  };
}
