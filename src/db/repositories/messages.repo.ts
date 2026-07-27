import { db } from '../pool.js';
import type { ChatMessage, MessageRole } from '../../types/index.js';

export const messagesRepo = {
  /** Last N messages for this user, oldest first (ready to feed into the LLM). */
  history(userId: number, limit = 20): ChatMessage[] {
    const rows = db
      .prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT ?')
      .all(userId, limit) as ChatMessage[];
    return rows.reverse();
  },

  add(userId: number, role: MessageRole, content: string): void {
    db.prepare('INSERT INTO messages (user_id, role, content) VALUES (?, ?, ?)').run(userId, role, content);
  },

  clear(userId: number): void {
    db.prepare('DELETE FROM messages WHERE user_id = ?').run(userId);
  },
};
