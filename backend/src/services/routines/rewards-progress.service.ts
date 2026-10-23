import { rewardsModel } from '../../models/rewards.model.js';
import { todosModel } from '../../models/todos.model.js';
import { habitLogsModel } from '../../models/habit-logs.model.js';
import { addDays, todayLocal, weekStartOf } from '../../shared/utils/datetime.js';
import { countOccurrences, scheduleOf } from './routine-schedule.js';

/**
 * Rewards and punishments brought back up instead of just sitting in a log: the ones tied to a
 * routine are a standing weekly deal ("si cumplo el gym toda la semana, pizza"), measured against
 * that routine's week; the loose ones count only for the week they were set.
 */
export interface RewardInPlay {
  type: 'reward' | 'punishment';
  description: string;
  routine: string | null;
  done: number;
  due: number;
}

/** What's in play between `from` and `to` (inclusive dates), with each linked routine's progress in that span. */
function rewardsInPlay(userId: number, from: string, to: string): RewardInPlay[] {
  const routines = new Map(todosModel.list(userId, { scope: 'routine' }).map((r) => [r.id, r]));
  const seen = new Set<string>();
  const out: RewardInPlay[] = [];
  for (const rp of rewardsModel.listAll(userId)) {
    const routine = rp.todo_id ? routines.get(rp.todo_id) : undefined;
    if (!routine && (rp.date < from || rp.date > to)) continue;
    // the same deal registered twice shows once
    const key = `${rp.type}|${rp.description.trim().toLowerCase()}|${rp.todo_id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const due = routine ? countOccurrences(scheduleOf(routine), from, to) : 0;
    const done = routine ? Math.min(habitLogsModel.countDoneInRange(routine.id, from, to), due) : 0;
    out.push({ type: rp.type, description: rp.description, routine: routine?.title ?? null, done, due });
  }
  return out.sort((a, b) => (a.type === b.type ? 0 : a.type === 'reward' ? -1 : 1)); // rewards first
}

/** "🏆 Pizza · Gym 3 de 5": the agenda's line(s) for this week (Monday to Sunday), progress so far. */
export function rewardsAgendaLines(userId: number): string[] {
  const today = todayLocal();
  const monday = weekStartOf(today);
  const sunday = addDays(monday, 6).slice(0, 10);
  // due over the whole week, done so far
  const soFar = rewardsInPlay(userId, monday, today);
  const items = rewardsInPlay(userId, monday, sunday).map((r) => {
    const icon = r.type === 'reward' ? '🏆' : '⚠️';
    const done = soFar.find((x) => x.type === r.type && x.description === r.description && x.routine === r.routine)?.done ?? 0;
    const progress = r.routine && r.due > 0 ? ` · ${r.routine} ${done} de ${r.due}` : '';
    return `${icon} ${r.description}${progress}`;
  });
  return items.length ? ['', '🎯 *EN JUEGO ESTA SEMANA*', ...items.slice(0, 5)] : [];
}

/** The weekly report's verdict per deal: earned, owed, or just a reminder for the loose ones. */
export function rewardsReportLines(userId: number, from: string, to: string): string[] {
  const items = rewardsInPlay(userId, from, to);
  if (items.length === 0) return [];
  const lines = ['', '🎯 *Premios y castigos*'];
  for (const r of items.slice(0, 8)) {
    if (!r.routine || r.due === 0) {
      lines.push(`${r.type === 'reward' ? '🏆' : '⚠️'} ${r.description}${r.type === 'reward' ? ' - ¿te lo diste?' : ' - ¿lo cumpliste?'}`);
      continue;
    }
    const complete = r.done >= r.due;
    if (r.type === 'reward') lines.push(complete ? `🎉 *Te ganaste:* ${r.description} · ${r.routine} ${r.done}/${r.due}` : `😕 Sin premio: ${r.description} · ${r.routine} ${r.done}/${r.due}`);
    else lines.push(complete ? `🙌 Te salvaste del castigo: ${r.description} · ${r.routine} ${r.done}/${r.due}` : `⚠️ *Te toca:* ${r.description} · ${r.routine} ${r.done}/${r.due}`);
  }
  return lines;
}
