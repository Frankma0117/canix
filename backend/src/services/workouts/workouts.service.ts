import { todosModel } from '../../models/todos.model.js';
import { routineStreak, weekProgress } from '../routines/routine-schedule.js';
import { todayLocal } from '../../shared/utils/datetime.js';
import type { Todo, WorkoutKind } from '../../entities/index.js';

/**
 * Ejercicios: boxeo, zumba, gym, correr, yoga... Each one is a routine (scope 'routine') with a
 * workout_kind, so it keeps everything a routine already does - the notice at its hour with the
 * 👍/👎 answer, the streak, pausing, moving it for today, its exercises broken down - and adds where
 * it's done, notes and the week's sessions and minutes. A routine without workout_kind stays in
 * Rutinas y hábitos.
 */

export const WORKOUT_KINDS: Record<WorkoutKind, { label: string; emoji: string }> = {
  combat: { label: 'Combate', emoji: '🥊' },
  dance: { label: 'Baile', emoji: '💃' },
  strength: { label: 'Fuerza y gym', emoji: '🏋️' },
  cardio: { label: 'Cardio', emoji: '🏃' },
  flexibility: { label: 'Yoga y estiramiento', emoji: '🧘' },
  sport: { label: 'Deporte', emoji: '⚽' },
  other: { label: 'Otro ejercicio', emoji: '💪' },
};

export function isWorkoutKind(value: unknown): value is WorkoutKind {
  return typeof value === 'string' && value in WORKOUT_KINDS;
}

// Most specific first: "rutina de pesas" is strength even though it also says "rutina".
const KIND_RULES: [RegExp, WorkoutKind][] = [
  [/\b(box(eo)?|kick|muay|mma|karate|taekwondo|judo|jiu|jitsu|defensa personal|artes marciales|capoeira)/, 'combat'],
  [/\b(zumba|baile|bailar|danza|salsa|bachata|ritmos|aerorumba|dance|ballet|reggaet[oó]n|twerk)/, 'dance'],
  [/\b(yoga|pilates|estir(ar|amiento)|movilidad|flexibilidad|stretch)/, 'flexibility'],
  [/\b(gym|gimnasio|pesas|crossfit|funcional|calistenia|fuerza|pierna|gl[uú]teos?|abdominales|abdomen|brazos?|espalda|pecho|hombros?|sentadillas|flexiones|plancha)/, 'strength'],
  [/\b(correr|trotar|running|caminar|caminata|bici|bicicleta|ciclismo|spinning|el[ií]ptica|saltar (la )?cuerda|lazo|hiit|aer[oó]bicos?|cardio|escaladora|trote)/, 'cardio'],
  [/\b(f[uú]tbol|futbol|nataci[oó]n|nadar|piscina|tenis|b[aá]squet|baloncesto|voleibol|v[oó]ley|p[aá]del|patinaje|patinar|escalada|squash|golf|rugby|surf|remo)/, 'sport'],
  [/\b(ejercicio|ejercitarme|entrenar|entrenamiento|workout|deporte|actividad f[ií]sica|clase de)/, 'other'],
];

/** What kind of exercise a title is about, or null when it isn't one ("leer 20 minutos"). */
export function guessWorkoutKind(title: string): WorkoutKind | null {
  const t = title.toLowerCase();
  return KIND_RULES.find(([re]) => re.test(t))?.[1] ?? null;
}

export function listWorkouts(userId: number): Todo[] {
  return todosModel.list(userId, { scope: 'routine' }).filter((t) => t.workout_kind);
}

/** This week (Monday to Sunday) of one workout: sessions due, done, minutes done, and its streak. */
export function workoutWeek(todo: Todo, today: string = todayLocal()): { done: number; due: number; minutes: number; streak: number } {
  const week = weekProgress(todo, today);
  return { ...week, minutes: week.done * (todo.duration_minutes ?? 0), streak: routineStreak(todo, today) };
}

/** Every workout's week added up: "4 de 6 sesiones · 3 h 20 min". */
export function weekSummary(userId: number, today: string = todayLocal()): { done: number; due: number; minutes: number } {
  return listWorkouts(userId)
    .map((t) => workoutWeek(t, today))
    .reduce((sum, w) => ({ done: sum.done + w.done, due: sum.due + w.due, minutes: sum.minutes + w.minutes }), { done: 0, due: 0, minutes: 0 });
}

/** 200 -> "3 h 20 min", 45 -> "45 min". */
export function minutesText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}
