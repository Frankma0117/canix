export type RewardPunishmentType = 'reward' | 'punishment';

/** @public - domain record shape, read by its model. */
export interface RewardPunishment {
  id: number;
  user_id: number;
  todo_id: number | null; // linked routine/habit, if any
  type: RewardPunishmentType;
  description: string;
  note: string | null;
  date: string; // 'YYYY-MM-DD'
  created_at: string;
}
