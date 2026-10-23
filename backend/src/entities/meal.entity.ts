export type MealSlot = 'desayuno' | 'onces' | 'almuerzo' | 'media_tarde' | 'cena';

export interface MealPlan {
  id: number;
  user_id: number;
  plan_date: string; // 'YYYY-MM-DD'
  meal_slot: MealSlot;
  title: string;
  notes: string | null;
  /** 'HH:mm' - with it, a reminder announces the meal. */
  meal_time: string | null;
  /** Minutes before meal_time to announce "toca preparar"; NULL = no prep notice. */
  prep_minutes: number | null;
  created_at: string;
}

export interface Recipe {
  id: number;
  user_id: number;
  title: string;
  ingredients: string;
  instructions: string;
  category_id: number | null;
  created_at: string;
}
