import { iconFor } from '../../shared/utils/icons.js';
import { exercisesBlock } from '../../agent/views.js';
import { exercisesModel } from '../../models/exercises.model.js';
import { reminderPromptsModel } from '../../models/reminder-prompts.model.js';
import { remindersModel } from '../../models/reminders.model.js';
import { todosModel } from '../../models/todos.model.js';
import { habitLogsModel } from '../../models/habit-logs.model.js';
import { usersModel } from '../../models/users.model.js';
import { nowLocal, todayLocal, parseWall, dateOnly, addMinutes } from '../../shared/utils/datetime.js';
import { stripKnownPrefix } from '../../shared/utils/motivational.js';
import { reactionFooter, shortTime } from '../../shared/utils/wa-format.js';
import { routineStreak, weekProgress } from '../routines/routine-schedule.js';
import { maybeNightFarewell } from '../agenda/agenda.service.js';
import { env } from '../../config/env.js';
import { medicationsModel } from '../../models/medications.model.js';
import { mealPlansModel } from '../../models/meal-plans.model.js';
import { medicationNotice, waterProgressLine } from '../medications/medications.service.js';
import { mealNotice } from '../meals/meal-reminders.service.js';
import type { WaManager } from '../../channels/whatsapp/wa-manager.js';
import type { PromptAnswer, PromptSource, Reminder, ReminderPrompt, Todo } from '../../entities/index.js';

/**
 * "¿Lo hiciste?" for what the bot reminds people of. WhatsApp only offers real buttons to Business
 * API accounts, so on a normal number a routine's notice and the person's own plain reminders are
 * confirmed by reacting to them (👍 done, 👎 not done) - one message, no extra poll. Replying
 * "sí"/"no" to the notice works too. Every answer (and every change of answer) is stored with its
 * time and where it came from, because things often get done on time and marked later - see the
 * reminder_prompts / reminder_responses tables.
 */

const YES_RE = /^(s[ií]+|sip|sisas|listo|hecho|hecha|ya|ya lo hice|ya la hice|cumplido|cumplida|cumpl[ií]|✅|👍)[\s.!]*$/i;
const NO_RE = /^(no+|nop|nel|todav[ií]a no|a[uú]n no|no pude|no lo hice|no la hice|❌|👎)[\s.!]*$/i;

/** A short "sí"/"no" typed as a reply to the reminder; null for anything else. */
export function answerFromText(text: string): PromptAnswer | null {
  const t = text.trim();
  if (YES_RE.test(t)) return 'yes';
  if (NO_RE.test(t)) return 'no';
  return null;
}

/** WhatsApp only renders *bold* around a single line with no inner asterisks. */
function bold(text: string): string {
  const t = text.trim();
  return !t || t.includes('\n') || t.includes('*') ? t : `*${t}*`;
}

/** "🏃 *Cardio*" - the title in bold with the emoji that fits it (see shared/utils/icons.ts). */
function titled(rawTitle: string, fallback = '🔹'): string {
  const title = rawTitle.trim().replace(/^\p{Ll}/u, (c) => c.toUpperCase());
  const icon = /\p{Extended_Pictographic}/u.test(title) ? '' : `${iconFor(title, fallback)} `;
  return `${icon}${bold(title)}`;
}

/** Routine notices ask for confirmation unless confirmations are off. */
function confirmsRoutine(reminder: Reminder): boolean {
  if (env.reminderConfirmations === 'off') return false;
  return (reminder.kind === 'routine_reminder' || reminder.kind === 'routine_checkin') && !!reminder.todo_id;
}

/** The person's own plain reminders are confirmed with a reaction - one aimed at somebody else is
 *  a message to them, not a task of theirs to confirm. */
function wantsReaction(reminder: Reminder, target: string): boolean {
  if (reminder.kind === 'medication') return env.reminderConfirmations !== 'off';
  if (env.reminderConfirmations !== 'all') return false;
  if (reminder.kind !== 'reminder' && reminder.kind !== 'flexible') return false;
  const owner = usersModel.getById(reminder.user_id);
  return !!owner && (target === owner.jid || target === owner.lid);
}

const REACTION_HINT = reactionFooter('Hecho', 'No lo hice');

/** "🔥 Racha 5 · 3 de 4 esta semana" - empty parts are left out. */
function progressLine(routine: Todo): string {
  const today = todayLocal();
  const streak = routineStreak(routine, today);
  const week = weekProgress(routine, today);
  const parts: string[] = [];
  if (streak > 0) parts.push(`🔥 Racha ${streak}`);
  if (week.due > 0) parts.push(`${week.done} de ${week.due} esta semana`);
  return parts.join(' · ');
}

/** The reminder text as it goes out: lead-in line, the thing itself in bold, then the details. */
function formatReminderText(reminder: Reminder, routine?: Todo): string {
  if (routine) {
    const details = [`🕒 ${shortTime(reminder.run_at)}`];
    if (routine.duration_minutes) details.push(`⏱️ ${routine.duration_minutes} min`);
    // What to do, right in the notice, when the routine has its exercises broken down.
    const exercises = exercisesModel.listByRoutine(routine.user_id, routine.id);
    const plan = exercises.length ? `\n\n${exercisesBlock(exercises)}` : '';
    const progress = progressLine(routine);
    return `⏰ Es hora de tu rutina\n${titled(routine.title)}\n${details.join('  ·  ')}${progress ? `\n${progress}` : ''}${plan}`;
  }
  if (reminder.kind === 'medication' && reminder.medication_id) {
    const med = medicationsModel.getByIdUnscoped(reminder.medication_id);
    if (med) return medicationNotice(med);
  }
  if ((reminder.kind === 'meal' || reminder.kind === 'meal_prep') && reminder.meal_plan_id) {
    const plan = mealPlansModel.getById(reminder.user_id, reminder.meal_plan_id);
    if (plan) return mealNotice(plan, reminder.kind);
  }
  // A plain label, then the thing itself - no chatty lead-in. Flexible ones created earlier still
  // carry an old lead-in in their text, removed here.
  if (reminder.kind === 'reminder' || reminder.kind === 'flexible') return `⏰ Recordatorio\n${titled(stripKnownPrefix(reminder.message), '🔔')}`;
  // Important dates carry their own emoji/wording from creation time.
  return reminder.message;
}

/**
 * Sends a due reminder: the formatted text with the 👍/👎 footer when it's something to confirm.
 * Throws only if the text couldn't be sent. Returns how many WhatsApp messages actually went out,
 * for the send governor.
 */
export async function sendReminderWithPrompt(wa: WaManager, reminder: Reminder, target: string): Promise<number> {
  const isRoutine = reminder.kind === 'routine_reminder' || reminder.kind === 'routine_checkin';
  const routine = isRoutine && reminder.todo_id ? todosModel.getById(reminder.user_id, reminder.todo_id) : undefined;
  // A check-in (no longer sent by the scheduler, see task-scheduler.ts) belongs to the day the
  // routine started, which is `duration` before it.
  const isCheckin = reminder.kind === 'routine_checkin';
  const occurrenceDate = dateOnly(isCheckin && routine ? addMinutes(reminder.run_at, -(routine.duration_minutes ?? 0)) : reminder.run_at);
  const byReaction = (confirmsRoutine(reminder) && !!routine) || wantsReaction(reminder, target);
  const body = isCheckin && routine ? `⏰ ¿Ya hiciste tu rutina?\n${titled(routine.title)}` : formatReminderText(reminder, routine);
  const textMsgId = await wa.sendTextWithId(target, byReaction ? `${body}\n\n${REACTION_HINT}` : body);
  if (!byReaction) return 1;

  const title = routine?.title ?? reminder.message;

  reminderPromptsModel.create({
    userId: reminder.user_id,
    reminderId: reminder.id,
    todoId: routine?.id ?? null,
    medicationId: reminder.medication_id ?? null,
    title,
    occurrenceDate,
    sentAt: nowLocal(),
    textMsgId,
  });
  return 1;
}

function delayNote(prompt: ReminderPrompt, at: string): string {
  if (!prompt.sent_at) return '';
  const minutes = Math.round((parseWall(at).getTime() - parseWall(prompt.sent_at).getTime()) / 60_000);
  if (minutes < 10) return '';
  const span = minutes < 60 ? `${minutes} min` : minutes < 1440 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${Math.floor(minutes / 1440)} día(s)`;
  return `\n_Marcado ${span} después del aviso._`;
}

/**
 * Applies an answer that came from WhatsApp itself (a 👍/👎 reaction, or a quoted
 * "sí"/"no"): stores it in the sequence, marks the routine for that day, and returns the
 * acknowledgement to send back - always, for a yes and for a no alike, so the person knows it was
 * registered. null = nothing changed (same answer given again), so nothing should be sent.
 */
export function applyAnswer(prompt: ReminderPrompt, answer: PromptAnswer, source: PromptSource): { ack: string; celebrate: boolean } | null {
  // Any tap or reply is proof the chat is two-way - same as a normal message (see agent.ts).
  remindersModel.confirmForUser(prompt.user_id);
  if (prompt.answer === answer) return null;

  const at = nowLocal();
  reminderPromptsModel.setAnswer(prompt.id, answer, source, at);

  const routine = prompt.todo_id ? todosModel.getById(prompt.user_id, prompt.todo_id) : undefined;
  if (prompt.medication_id) {
    const med = medicationsModel.getByIdUnscoped(prompt.medication_id);
    if (med?.kind === 'water') {
      return { ack: (answer === 'yes' ? `💧 ¡Un vaso más! ${waterProgressLine(med, prompt.occurrence_date)}` : '📝 Anotado: esta vez no tomaste agua') + delayNote(prompt, at), celebrate: false };
    }
    return {
      ack: (answer === 'yes' ? `✅ Anotado: ${titled(prompt.title, '💊')} ✔️` : `📝 Anotado: esta vez no ${titled(prompt.title, '💊')}`) + delayNote(prompt, at),
      celebrate: false,
    };
  }
  if (!routine) {
    return {
      ack: (answer === 'yes' ? `✅ Marcado como hecho: ${titled(prompt.title, '🔔')}` : `📝 Marcado como no hecho: ${titled(prompt.title, '🔔')}`) + delayNote(prompt, at),
      celebrate: false,
    };
  }

  habitLogsModel.checkIn(routine.id, prompt.occurrence_date, answer === 'yes', null);
  const progress = progressLine(routine);
  const progressNote = progress ? `\n${progress}` : '';
  if (answer === 'no') {
    return {
      ack: `📝 Marcado: ${titled(routine.title)} no se hizo esta vez.${progressNote}${delayNote(prompt, at)}`,
      celebrate: false,
    };
  }
  const farewell = prompt.occurrence_date === todayLocal() ? maybeNightFarewell(prompt.user_id) : null;
  return {
    ack: `✅ Marcado: ${titled(routine.title)} cumplida 🎉${progressNote}${delayNote(prompt, at)}${farewell ? `\n\n${farewell}` : ''}`,
    celebrate: true,
  };
}

/**
 * Records a routine check-in made outside the notice (told to the bot in chat, or marked on the
 * portal) in the same answer sequence, so the history shows every mark wherever it came from. The
 * caller has already written the habit log itself.
 */
export function logRoutineAnswer(userId: number, todoId: number, date: string, done: boolean, source: PromptSource): void {
  const todo = todosModel.getById(userId, todoId);
  if (!todo) return;
  const prompt =
    reminderPromptsModel.findForRoutineDate(todoId, date) ??
    reminderPromptsModel.create({ userId, reminderId: null, todoId, title: todo.title, occurrenceDate: date, sentAt: null });
  const answer: PromptAnswer = done ? 'yes' : 'no';
  if (prompt.answer === answer) return;
  reminderPromptsModel.setAnswer(prompt.id, answer, source, nowLocal());
}
