export type MedicationKind = 'medicine' | 'vitamin' | 'supplement' | 'cream' | 'skincare' | 'water' | 'bodycare' | 'other';

/**
 * Something taken or applied on a schedule - a pill, a vitamin, a cream, a skincare step, water
 * (kind 'water': each notice answered 👍 counts as one glass toward the day's goal), body care such as
 * putting on / taking off a girdle (kind 'bodycare', named by the action: "Ponerme la faja"). Each of
 * its `times` becomes a reminder (kind 'medication') that says "toca tomar…" and is confirmed with
 * a reaction; see services/medications/medications.service.ts.
 */
export interface Medication {
  id: number;
  user_id: number;
  name: string;
  kind: MedicationKind;
  /** "1 tableta", "500 mg", "una capa delgada". */
  dose: string | null;
  /** "con el desayuno", "en ayunas", "en la cara limpia". */
  instructions: string | null;
  /** JSON array of 'HH:mm', sorted. */
  times: string;
  /** "1,3,5" (0 = Sunday); NULL = every day. */
  weekdays: string | null;
  /** 'YYYY-MM-DD' - no doses before it. */
  start_date: string | null;
  /** 'YYYY-MM-DD' - last day of a treatment; NULL = ongoing. */
  end_date: string | null;
  notes: string | null;
  /** 0 = paused (its reminders are removed until resumed). */
  active: number;
  created_at: string;
  updated_at: string;
}
