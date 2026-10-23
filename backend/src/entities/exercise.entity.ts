/** One exercise within a routine (scope='routine' todo) - see exercises.model.ts. */
export interface Exercise {
  id: number;
  user_id: number;
  todo_id: number;
  name: string;
  sets: number | null;
  reps: number | null;
  seconds: number | null; // for time-based exercises (plancha, etc.) instead of reps
  weight_kg: number | null;
  order_index: number;
  created_at: string;
}
