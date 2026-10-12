import { db } from '../pool.js';

/** One possible answer: how it's shown, and what it counts as if the person had typed it. */
export interface ChoiceOption {
  label: string;
  reply: string;
}

/** A closed question the bot asked, tied to the WhatsApp message that carries it. */
export interface ChoicePrompt {
  id: number;
  user_id: number;
  msg_id: string;
  options: ChoiceOption[];
  /** Yes/no question: option 0 is the "yes", option 1 the "no" - answerable with 👍 / 👎. */
  binary: boolean;
  /** Its answers are complete commands on their own, so it stays valid while the chat moves on. */
  sticky: boolean;
  status: 'open' | 'closed';
  created_at: string;
}

type Row = Omit<ChoicePrompt, 'options' | 'binary' | 'sticky'> & { options: string; is_binary: number; is_sticky: number };

function parse(row: Row | undefined): ChoicePrompt | undefined {
  if (!row) return undefined;
  let options: ChoiceOption[] = [];
  try {
    options = JSON.parse(row.options) as ChoiceOption[];
  } catch {
    /* unreadable row - treated as having no options */
  }
  return { id: row.id, user_id: row.user_id, msg_id: row.msg_id, options, binary: !!row.is_binary, sticky: !!row.is_sticky, status: row.status, created_at: row.created_at };
}

export const choicePromptsRepo = {
  create(userId: number, msgId: string, options: ChoiceOption[], flags: { binary: boolean; sticky: boolean }, createdAt: string): void {
    db.prepare('INSERT INTO choice_prompts (user_id, msg_id, options, is_binary, is_sticky, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      userId,
      msgId,
      JSON.stringify(options),
      flags.binary ? 1 : 0,
      flags.sticky ? 1 : 0,
      createdAt,
    );
    // Old rows only serve to say "that question already passed" - a week is plenty.
    db.prepare(`DELETE FROM choice_prompts WHERE created_at < datetime('now', '-8 days')`).run();
  },

  findByMessageId(userId: number, msgId: string): ChoicePrompt | undefined {
    return parse(db.prepare('SELECT * FROM choice_prompts WHERE user_id = ? AND msg_id = ? ORDER BY id DESC LIMIT 1').get(userId, msgId) as Row | undefined);
  },

  /** The question currently waiting for this person's answer, if any. */
  openFor(userId: number): ChoicePrompt | undefined {
    return parse(
      db.prepare(`SELECT * FROM choice_prompts WHERE user_id = ? AND status = 'open' AND is_sticky = 0 ORDER BY id DESC LIMIT 1`).get(userId) as Row | undefined,
    );
  },

  close(id: number): void {
    db.prepare(`UPDATE choice_prompts SET status = 'closed' WHERE id = ?`).run(id);
  },

  /** The conversation moved on (the person wrote or reacted): earlier questions no longer wait for
   *  an answer, so a late reaction to one of them can't be taken as a reply to something else. */
  closeOpenFor(userId: number): void {
    db.prepare(`UPDATE choice_prompts SET status = 'closed' WHERE user_id = ? AND status = 'open' AND is_sticky = 0`).run(userId);
  },
};
