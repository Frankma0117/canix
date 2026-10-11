import { db } from '../pool.js';

/** One tappable answer: what the button says, and what it counts as if the person had typed it. */
export interface ChoiceOption {
  label: string;
  reply: string;
}

export interface ChoicePoll {
  id: number;
  user_id: number;
  poll_msg_id: string;
  poll_secret: Buffer;
  options: ChoiceOption[];
  status: 'open' | 'closed';
  created_at: string;
}

type Row = Omit<ChoicePoll, 'options'> & { options: string };

/** Old rows are only useful to tell "that question already passed" - a week is plenty. */
const KEEP_DAYS = 7;

export const choicePollsRepo = {
  create(userId: number, pollMsgId: string, secret: Uint8Array, options: ChoiceOption[], createdAt: string): void {
    db.prepare('INSERT INTO choice_polls (user_id, poll_msg_id, poll_secret, options, created_at) VALUES (?, ?, ?, ?, ?)').run(
      userId,
      pollMsgId,
      Buffer.from(secret),
      JSON.stringify(options),
      createdAt,
    );
    db.prepare(`DELETE FROM choice_polls WHERE created_at < datetime('now', ?)`).run(`-${KEEP_DAYS + 1} days`);
  },

  findByMessageId(userId: number, pollMsgId: string): ChoicePoll | undefined {
    const row = db.prepare('SELECT * FROM choice_polls WHERE user_id = ? AND poll_msg_id = ?').get(userId, pollMsgId) as Row | undefined;
    if (!row) return undefined;
    let options: ChoiceOption[] = [];
    try {
      options = JSON.parse(row.options) as ChoiceOption[];
    } catch {
      /* unreadable row - treated as having no options */
    }
    return { ...row, options };
  },

  /** The conversation moved on (the person wrote or tapped something): earlier questions no longer
   *  wait for an answer, so a late tap on one of them can't be taken as a reply to something else. */
  closeOpenFor(userId: number): void {
    db.prepare(`UPDATE choice_polls SET status = 'closed' WHERE user_id = ? AND status = 'open'`).run(userId);
  },
};
