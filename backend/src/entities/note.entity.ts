/** A free-text "important note" (idea, piece of info, something to remember) - NOT a task or
 *  reminder: no date, no time, no status, just content to find again later (see notes.model.ts). */
export interface Note {
  id: number;
  user_id: number;
  category_id: number | null;
  title: string | null;
  content: string;
  created_at: string;
  updated_at: string;
}
