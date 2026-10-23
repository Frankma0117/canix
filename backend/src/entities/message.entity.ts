export type MessageRole = 'user' | 'assistant';

/** @public - domain record shape, read by its model. */
export interface ChatMessage {
  id: number;
  user_id: number;
  role: MessageRole;
  content: string;
  created_at: string;
}
