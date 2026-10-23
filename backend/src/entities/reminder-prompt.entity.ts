export type PromptAnswer = 'yes' | 'no';

/** Where an answer came from: the poll under the reminder, a quoted "sí/no" reply, telling the bot
 *  in chat (checkin_routine), or the web portal. */
export type PromptSource = 'poll' | 'reply' | 'chat' | 'web';

/** One occurrence of a reminder/routine that can be answered "sí/no" (see services/reminders/reminder-prompts.service.ts). */
export interface ReminderPrompt {
  id: number;
  user_id: number;
  reminder_id: number | null;
  todo_id: number | null;
  medication_id: number | null;
  title: string;
  occurrence_date: string; // 'YYYY-MM-DD'
  sent_at: string | null; // NULL = answered without a notice having gone out (marked by hand)
  text_msg_id: string | null;
  poll_msg_id: string | null;
  poll_secret: Buffer | null;
  answer: PromptAnswer | null;
  answered_at: string | null;
  answer_source: PromptSource | null;
  created_at: string;
}

/** @public - domain record shape, read by its model. */
export interface ReminderResponse {
  id: number;
  prompt_id: number;
  answer: PromptAnswer;
  source: PromptSource;
  created_at: string;
}
