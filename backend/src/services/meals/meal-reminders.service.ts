import { mealPlansModel } from '../../models/meal-plans.model.js';
import { remindersModel } from '../../models/reminders.model.js';
import { usersModel } from '../../models/users.model.js';
import { addMinutes, nowLocal } from '../../shared/utils/datetime.js';
import type { MealPlan, MealSlot } from '../../entities/index.js';

/**
 * A planned meal with a time gets its own notices: "🍽️ Hora del almuerzo" at the time and, when
 * prep_minutes is set, "👩‍🍳 Toca preparar…" that many minutes before (reminder kinds 'meal' and
 * 'meal_prep', owned by the plan - editing or deleting the plan updates or removes them).
 */

/** Usual hour of each meal, for "avísame a la hora" without a time. */
export const DEFAULT_MEAL_TIMES: Record<MealSlot, string> = {
  desayuno: '07:00',
  onces: '10:00',
  almuerzo: '12:30',
  media_tarde: '16:00',
  cena: '19:30',
};

const SLOT_WORDS: Record<MealSlot, { name: string; article: string }> = {
  desayuno: { name: 'desayuno', article: 'el' },
  onces: { name: 'onces', article: 'las' },
  almuerzo: { name: 'almuerzo', article: 'el' },
  media_tarde: { name: 'media tarde', article: 'la' },
  cena: { name: 'cena', article: 'la' },
};

/** Rebuilds a plan's notices: none without a time or when the time already passed. */
export function syncMealReminders(userId: number, planId: number): number {
  remindersModel.removeOwnedBy({ mealPlanId: planId });
  const plan = mealPlansModel.getById(userId, planId);
  const owner = usersModel.getById(userId);
  if (!plan?.meal_time || !owner) return 0;
  const at = `${plan.plan_date} ${plan.meal_time}:00`;
  const now = nowLocal();
  let created = 0;
  const add = (kind: 'meal' | 'meal_prep', runAt: string) => {
    if (runAt <= now) return;
    remindersModel.create(userId, { message: plan.title, runAt, targetJid: owner.jid, categoryId: null, recurrenceFreq: 'none', recurrenceInterval: 1, kind, mealPlanId: plan.id });
    created++;
  };
  add('meal', at);
  if (plan.prep_minutes && plan.prep_minutes > 0) add('meal_prep', addMinutes(at, -plan.prep_minutes));
  return created;
}

/** The notice text: the meal at its time, or the reminder to prepare it. */
export function mealNotice(plan: MealPlan, kind: 'meal' | 'meal_prep'): string {
  const slot = SLOT_WORDS[plan.meal_slot];
  const title = `*${plan.title.replace(/\*/g, '')}*`;
  const notes = plan.notes ? `\n> ${plan.notes}` : '';
  if (kind === 'meal_prep') return `👩‍🍳 Toca preparar ${slot.article} ${slot.name} (en ${plan.prep_minutes} min)\n${title}${notes}`;
  return `🍽️ Hora ${slot.article === 'el' ? 'del' : `de ${slot.article}`} ${slot.name}\n${title}${notes}`;
}
