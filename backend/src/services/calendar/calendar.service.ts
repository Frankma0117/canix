import { todosModel } from '../../models/todos.model.js';
import { remindersModel } from '../../models/reminders.model.js';
import { habitLogsModel } from '../../models/habit-logs.model.js';
import { callRemindersModel } from '../../models/call-reminders.model.js';
import { mealPlansModel } from '../../models/meal-plans.model.js';
import { schedulingModel } from '../../models/scheduling.model.js';
import { medicationsModel } from '../../models/medications.model.js';
import { reminderPromptsModel } from '../../models/reminder-prompts.model.js';
import { MEDICATION_KINDS, dueOn, timesOf } from '../medications/medications.service.js';
import { scheduleOf, occursOn } from '../routines/routine-schedule.js';
import { addDays, addMinutes, addMonths } from '../../shared/utils/datetime.js';
import { stripKnownPrefix } from '../../shared/utils/motivational.js';
import { USER_REMINDER_KINDS } from '../reminders/reminder-kinds.js';
import type { RecurrenceFreq } from '../../entities/index.js';

/**
 * Everything with a date in a range, as calendar events for the portal's agenda view: routines
 * (expanded day by day from their schedule, with whether they were done), reminders and call
 * reminders (recurring ones expanded), to-dos with a due date (all-day), the meal plan (at its own
 * time when it has one), each dose of Medicamentos y belleza and appointments. Only what the person's permissions cover is included.
 */
export type CalendarEventKind = 'routine' | 'reminder' | 'todo' | 'call' | 'meal' | 'medication' | 'appointment';

export interface CalendarEvent {
  /** Unique within the response: kind + source id + date. */
  key: string;
  kind: CalendarEventKind;
  sourceId: number;
  title: string;
  /** 'YYYY-MM-DD HH:mm:ss' local time; all-day events use 00:00:00. */
  start: string;
  end: string;
  allDay: boolean;
  /** Routines, to-dos and doses: done that day; null when it doesn't apply or wasn't marked yet. */
  done: boolean | null;
  detail?: string;
}

const MEAL_TIMES: Record<string, [string, string]> = {
  desayuno: ['07:00', 'Desayuno'],
  onces: ['10:00', 'Onces'],
  almuerzo: ['12:30', 'Almuerzo'],
  media_tarde: ['16:00', 'Media tarde'],
  cena: ['19:30', 'Cena'],
};
const MAX_OCCURRENCES = 400;

function step(at: string, freq: RecurrenceFreq, interval: number): string | null {
  const n = Math.max(1, interval);
  if (freq === 'daily') return addDays(at, n);
  if (freq === 'weekly') return addDays(at, 7 * n);
  if (freq === 'monthly') return addMonths(at, n);
  if (freq === 'yearly') return addMonths(at, 12 * n);
  return null;
}

/** Every occurrence of a (possibly recurring) date-time inside [from, to]. */
function occurrences(first: string, freq: RecurrenceFreq, interval: number, from: string, to: string): string[] {
  const out: string[] = [];
  let at: string | null = first;
  for (let i = 0; at && at.slice(0, 10) <= to && i < MAX_OCCURRENCES; i++) {
    if (at.slice(0, 10) >= from) out.push(at);
    if (freq === 'none') break;
    at = step(at, freq, interval);
  }
  return out;
}

function dates(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 370; d = addDays(d, 1).slice(0, 10)) out.push(d);
  return out;
}

export function calendarEvents(userId: number, from: string, to: string, can: (permission: string) => boolean): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  if (can('routines.manage') || can('workouts.manage')) {
    for (const routine of todosModel.list(userId, { scope: 'routine' })) {
      // Workouts (boxeo, zumba...) come with Ejercicios, plain routines with Rutinas.
      if (!can(routine.workout_kind ? 'workouts.manage' : 'routines.manage')) continue;
      const schedule = scheduleOf(routine);
      for (const date of dates(from, to)) {
        if (!occursOn(schedule, date)) continue;
        const start = `${date} ${schedule.time}:00`;
        const log = habitLogsModel.getForDate(routine.id, date);
        events.push({
          key: `routine-${routine.id}-${date}`,
          kind: 'routine',
          sourceId: routine.id,
          title: routine.title,
          start,
          end: addMinutes(start, routine.duration_minutes ?? 30),
          allDay: false,
          done: log ? log.done === 1 : null,
        });
      }
    }
  }

  if (can('reminders.manage')) {
    for (const r of remindersModel.listAll(userId, 'pending')) {
      if (!USER_REMINDER_KINDS.has(r.kind)) continue;
      const freq = r.kind === 'interval' ? 'none' : (r.recurrence_freq as RecurrenceFreq);
      for (const at of occurrences(r.run_at, freq, r.recurrence_interval, from, to)) {
        events.push({
          key: `reminder-${r.id}-${at}`,
          kind: 'reminder',
          sourceId: r.id,
          title: stripKnownPrefix(r.message),
          start: at,
          end: addMinutes(at, 15),
          allDay: false,
          done: null,
          detail: r.kind === 'important_date' ? 'Fecha importante' : undefined,
        });
      }
    }
  }

  if (can('todos.manage')) {
    for (const t of todosModel.list(userId)) {
      if (t.scope === 'routine' || !t.due_date) continue;
      const day = t.due_date.slice(0, 10);
      if (day < from || day > to) continue;
      events.push({
        key: `todo-${t.id}`,
        kind: 'todo',
        sourceId: t.id,
        title: t.title,
        start: `${day} 00:00:00`,
        end: `${day} 23:59:00`,
        allDay: true,
        done: t.status === 'done',
      });
    }
  }

  if (can('reminders.calls')) {
    for (const c of callRemindersModel.listAll(userId, 'pending')) {
      for (const at of occurrences(c.scheduled_at, c.recurrence_freq as RecurrenceFreq, c.recurrence_interval, from, to)) {
        events.push({
          key: `call-${c.id}-${at}`,
          kind: 'call',
          sourceId: c.id,
          title: c.call_type === 'alarm' ? 'Alarma por llamada' : c.message,
          start: at,
          end: addMinutes(at, 10),
          allDay: false,
          done: null,
        });
      }
    }
  }

  if (can('meals.manage')) {
    for (const m of mealPlansModel.listRange(userId, from, to)) {
      const [usual, label] = MEAL_TIMES[m.meal_slot] ?? ['12:00', m.meal_slot];
      const start = `${m.plan_date} ${m.meal_time ?? usual}:00`;
      events.push({ key: `meal-${m.id}`, kind: 'meal', sourceId: m.id, title: m.title, start, end: addMinutes(start, 45), allDay: false, done: null, detail: label });
    }
  }

  if (can('medications.manage')) {
    for (const med of medicationsModel.list(userId)) {
      // doses marked "taken" that day, in order: the first n times of the day count as done
      const taken = new Map<string, number>();
      const answered = new Map<string, number>();
      for (const p of reminderPromptsModel.listForMedication(med.id, from)) {
        if (p.answer === null) continue;
        answered.set(p.occurrence_date, (answered.get(p.occurrence_date) ?? 0) + 1);
        if (p.answer === 'yes') taken.set(p.occurrence_date, (taken.get(p.occurrence_date) ?? 0) + 1);
      }
      const kind = MEDICATION_KINDS[med.kind] ?? MEDICATION_KINDS.other;
      const detail = [kind.label, med.dose].filter(Boolean).join(' · ');
      for (let day = from; day <= to; day = addDays(day, 1).slice(0, 10)) {
        if (!dueOn(med, day)) continue;
        timesOf(med).forEach((time, i) => {
          const start = `${day} ${time}:00`;
          const done = i < (taken.get(day) ?? 0) ? true : i < (answered.get(day) ?? 0) ? false : null;
          events.push({ key: `med-${med.id}-${start}`, kind: 'medication', sourceId: med.id, title: med.name, start, end: addMinutes(start, 10), allDay: false, done, detail });
        });
      }
    }
  }

  if (can('scheduling.professional')) {
    const professional = schedulingModel.getProfessional(userId);
    if (professional) {
      for (const a of schedulingModel.listForProfessional(professional.user_id, `${from} 00:00:00`, `${to} 23:59:59`, ['pending', 'confirmed', 'completed'])) {
        events.push({ key: `appt-${a.id}`, kind: 'appointment', sourceId: a.id, title: `Cita con ${a.client_name ?? 'cliente'}`, start: a.start_at, end: a.end_at, allDay: false, done: null, detail: a.status });
      }
    }
  }
  if (can('scheduling.client')) {
    for (const a of schedulingModel.listForClient(userId, `${from} 00:00:00`)) {
      if (a.start_at.slice(0, 10) > to || !['pending', 'confirmed', 'completed'].includes(a.status)) continue;
      events.push({ key: `appt-${a.id}`, kind: 'appointment', sourceId: a.id, title: `Cita con ${a.professional_name}`, start: a.start_at, end: a.end_at, allDay: false, done: null, detail: a.status });
    }
  }

  return events.sort((a, b) => a.start.localeCompare(b.start));
}
