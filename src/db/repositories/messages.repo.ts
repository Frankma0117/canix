import { db } from '../pool.js';
import type { ChatMessage, MessageRole } from '../../types/index.js';

export const messagesRepo = {
  /** Last N messages, oldest first (ready to feed into the LLM). */
  history(limit = 20): ChatMessage[] {
    const rows = db
      .prepare('SELECT * FROM messages ORDER BY id DESC LIMIT ?')
      .all(limit) as ChatMessage[];
    return rows.reverse();
  },

  add(role: MessageRole, content: string): void {
    db.prepare('INSERT INTO messages (role, content) VALUES (?, ?)').run(role, content);
  },

  clear(): void {
    db.prepare('DELETE FROM messages').run();
  },
};
