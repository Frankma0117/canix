import { iconFor } from '../util/icons.js';
import { exercisesBlock } from './views.js';
import { exercisesRepo } from '../db/repositories/exercises.repo.js';
import { createHash, randomBytes } from 'node:crypto';
import { reminderPromptsRepo } from '../db/repositories/reminder-prompts.repo.js';
import { remindersRepo } from '../db/repositories/reminders.repo.js';
import { todosRepo } from '../db/repositories/todos.repo.js';
import { habitLogsRepo } from '../db/repositories/habit-logs.repo.js';
import { usersRepo } from '../db/repositories/users.repo.js';
import { nowLocal, todayLocal, parseWall, dateOnly, addMinutes } from '../util/datetime.js';
import { stripKnownPrefix } from '../util/motivational.js';
import { reactionFooter, shortTime } from '../util/wa-format.js';
import { routineStreak, weekProgress } from './routine-schedule.js';
import { maybeNightFarewell } from './agenda.js';
import { env } from '../config/env.js';
import type { WaManager } from '../whatsapp/wa-manager.js';
import type { PromptAnswer, PromptSource, Reminder, ReminderPrompt, Todo } from '../types/index.js';

/**
 * "¿Lo hiciste?" for what the bot reminds people of. WhatsApp only offers real buttons to Business
 * API accounts, so on a normal number:
 *   - a routine's notice comes with a single-choice poll (Sí / No) whose title carries the streak
 *     and the week's progress - it stays pinned to that notice and gets tapped hours later;
 *   - a plain reminder is confirmed by reacting to it (👍 done, 👎 not done) - no extra message.
 * A reaction works on a routine's notice too, and so does replying "sí"/"no" to either. Every
 * answer (and every change of answer) is stored with its time and where it came from, because
 * things often get done on time and marked later - see reminder_prompts / reminder_responses in
 * db/init.ts.
 */
export const POLL_YES = '✅ Sí, hecho';
export const POLL_NO = '❌ No';
const POLL_OPTIONS = [POLL_YES, POLL_NO];

const optionHash = (name: string) => createHash('sha256').update(name).digest('hex');
const YES_HASH = optionHash(POLL_YES);
const NO_HASH = optionHash(POLL_NO);

/** Which answer a decrypted vote (hex sha256 of each selected option) means; null = vote removed. */
export function answerFromVote(selectedHashes: string[]): PromptAnswer | null {
  if (selectedHashes.includes(YES_HASH)) return 'yes';
  if (selectedHashes.includes(NO_HASH)) return 'no';
  return null;
}

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

/** Routines get the poll. */
/** "🏃 *Cardio*" - the title in bold with the emoji that fits it (see util/icons.ts). */
function titled(rawTitle: string, fallback = '🔹'): string {
  const title = rawTitle.trim().replace(/^\p{Ll}/u, (c) => c.toUpperCase());
  const icon = /\p{Extended_Pictographic}/u.test(title) ? '' : `${iconFor(title, fallback)} `;
  return `${icon}${bold(title)}`;
}

function wantsPoll(reminder: Reminder): boolean {
  if (env.reminderConfirmPolls === 'off') return false;
  return (reminder.kind === 'routine_reminder' || reminder.kind === 'routine_checkin') && !!reminder.todo_id;
}

/** The person's own plain reminders are confirmed with a reaction - one aimed at somebody else is
 *  a message to them, not a task of theirs to confirm. */
function wantsReaction(reminder: Reminder, target: string): boolean {
  if (env.reminderConfirmPolls !== 'all') return false;
  if (reminder.kind !== 'reminder' && reminder.kind !== 'flexible') return false;
  const owner = usersRepo.getById(reminder.user_id);
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
export function formatReminderText(reminder: Reminder, routine?: Todo): string {
  if (routine) {
    const details = [`🕒 ${shortTime(reminder.run_at)}`];
    if (routine.duration_minutes) details.push(`⏱️ ${routine.duration_minutes} min`);
    // What to do, right in the notice, when the routine has its exercises broken down.
    const exercises = exercisesRepo.listByRoutine(routine.user_id, routine.id);
    const plan = exercises.length ? `\n\n${exercisesBlock(exercises)}` : '';
    const progress = progressLine(routine);
    return `⏰ Es hora de tu rutina\n${titled(routine.title)}\n${details.join('  ·  ')}${progress ? `\n${progress}` : ''}${plan}`;
  }
  // A plain label, then the thing itself - no chatty lead-in. Flexible ones created earlier still
  // carry an old lead-in in their text, removed here.
  if (reminder.kind === 'reminder' || reminder.kind === 'flexible') return `⏰ Recordatorio\n${titled(stripKnownPrefix(reminder.message), '🔔')}`;
  // Important dates carry their own emoji/wording from creation time.
  return reminder.message;
}

/**
 * Sends a due reminder: the formatted text and, for a routine, the Sí/No poll right under it (its
 * title carrying the streak). Throws only if the text itself couldn't be sent; a poll that fails
 * just leaves the notice without one (the routine then falls back to its written check-in, see
 * hasPollFor). Returns how many WhatsApp messages actually went out, for the send governor.
 */
export async function sendReminderWithPrompt(wa: WaManager, reminder: Reminder, target: string): Promise<number> {
  const isRoutine = reminder.kind === 'routine_reminder' || reminder.kind === 'routine_checkin';
  const routine = isRoutine && reminder.todo_id ? todosRepo.getById(reminder.user_id, reminder.todo_id) : undefined;
  // The written check-in (only sent when that day's notice went out without its poll - see
  // hasPollFor) is a question too, so it carries the same Sí/No; it belongs to the day the routine
  // started, which is `duration` before this check-in.
  const isCheckin = reminder.kind === 'routine_checkin';
  const occurrenceDate = dateOnly(isCheckin && routine ? addMinutes(reminder.run_at, -(routine.duration_minutes ?? 0)) : reminder.run_at);
  // No poll under routine notices any more: it asked the same thing twice (the notice already says
  // "reacciona"), and the count it carried now goes in the notice itself (see formatReminderText).
  const byPoll = false;
  const byReaction = (wantsPoll(reminder) && !!routine) || wantsReaction(reminder, target);
  const body = isCheckin && routine ? `⏰ ¿Ya hiciste tu rutina?\n${titled(routine.title)}` : formatReminderText(reminder, routine);
  // Routine notices carry the same footer: reacting marks them too, besides the poll under them.
  const textMsgId = await wa.sendTextWithId(target, byReaction || byPoll ? `${body}\n\n${REACTION_HINT}` : body);
  if (!byPoll && !byReaction) return 1;

  const title = routine?.title ?? reminder.message;
  const secret = randomBytes(32);
  let pollMsgId: string | null = null;
  if (byPoll && routine) {
    try {
      const shortTitle = title.length > 80 ? `${title.slice(0, 79)}…` : title;
      const progress = progressLine(routine);
      pollMsgId = await wa.sendPoll(target, `¿Ya hiciste "${shortTitle}"?${progress ? ` — ${progress}` : ''}`, POLL_OPTIONS, secret);
    } catch (err) {
      console.error('[PROMPT] No se pudo enviar la encuesta del recordatorio #%d:', reminder.id, (err as Error).message);
    }
  }

  reminderPromptsRepo.create({
    userId: reminder.user_id,
    reminderId: reminder.id,
    todoId: routine?.id ?? null,
    title,
    occurrenceDate,
    sentAt: nowLocal(),
    textMsgId,
    pollMsgId,
    pollSecret: pollMsgId ? secret : null,
  });
  return pollMsgId ? 2 : 1;
}

/** True when that day's notice of a routine went out with its poll - the written check-in question
 *  is then redundant and stays silent. */
export function hasPollFor(todoId: number, occurrenceDate: string): boolean {
  return !!reminderPromptsRepo.findForRoutineDate(todoId, occurrenceDate)?.poll_msg_id;
}

/** True when that day's notice was already answered (yes or no): nothing left to ask about it. */
export function answeredFor(todoId: number, occurrenceDate: string): boolean {
  return !!reminderPromptsRepo.findForRoutineDate(todoId, occurrenceDate)?.answer;
}

function delayNote(prompt: ReminderPrompt, at: string): string {
  if (!prompt.sent_at) return '';
  const minutes = Math.round((parseWall(at).getTime() - parseWall(prompt.sent_at).getTime()) / 60_000);
  if (minutes < 10) return '';
  const span = minutes < 60 ? `${minutes} min` : minutes < 1440 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${Math.floor(minutes / 1440)} día(s)`;
  return `\n_Marcado ${span} después del aviso._`;
}

/**
 * Applies an answer that came from WhatsApp itself (the poll, a 👍/👎 reaction, or a quoted
 * "sí"/"no"): stores it in the sequence, marks the routine for that day, and returns the
 * acknowledgement to send back - always, for a yes and for a no alike, so the person knows it was
 * registered. null = nothing changed (same answer given again), so nothing should be sent.
 */
export function applyAnswer(prompt: ReminderPrompt, answer: PromptAnswer, source: PromptSource): { ack: string; celebrate: boolean } | null {
  // Any tap or reply is proof the chat is two-way - same as a normal message (see ai-agent.ts).
  remindersRepo.confirmForUser(prompt.user_id);
  if (prompt.answer === answer) return null;

  const at = nowLocal();
  reminderPromptsRepo.setAnswer(prompt.id, answer, source, at);

  const routine = prompt.todo_id ? todosRepo.getById(prompt.user_id, prompt.todo_id) : undefined;
  if (!routine) {
    return {
      ack: (answer === 'yes' ? `✅ Marcado como hecho: ${titled(prompt.title, '🔔')}` : `📝 Marcado como no hecho: ${titled(prompt.title, '🔔')}`) + delayNote(prompt, at),
      celebrate: false,
    };
  }

  habitLogsRepo.checkIn(routine.id, prompt.occurrence_date, answer === 'yes', null);
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
 * Records a routine check-in made outside the poll (told to the bot in chat, or marked on the
 * portal) in the same answer sequence, so the history shows every mark wherever it came from. The
 * caller has already written the habit log itself.
 */
export function logRoutineAnswer(userId: number, todoId: number, date: string, done: boolean, source: PromptSource): void {
  const todo = todosRepo.getById(userId, todoId);
  if (!todo) return;
  const prompt =
    reminderPromptsRepo.findForRoutineDate(todoId, date) ??
    reminderPromptsRepo.create({ userId, reminderId: null, todoId, title: todo.title, occurrenceDate: date, sentAt: null });
  const answer: PromptAnswer = done ? 'yes' : 'no';
  if (prompt.answer === answer) return;
  reminderPromptsRepo.setAnswer(prompt.id, answer, source, nowLocal());
}
