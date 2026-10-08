import { db } from '../pool.js';

export const aiUsageRepo = {
  log(userId: number, operation: string, model: string, inputTokens: number, outputTokens: number): void {
    db.prepare('INSERT INTO ai_usage (user_id, operation, model, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?)').run(
      userId,
      operation,
      model,
      inputTokens,
      outputTokens,
    );
  },

  /** Total calls + tokens for a user in the trailing N days - "cuánto está gastando Fashion Mode",
   *  see the user's own spec for AIUsageService. */
  summaryForUser(userId: number, days: number): { calls: number; inputTokens: number; outputTokens: number } {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(output_tokens), 0) AS outputTokens
         FROM ai_usage WHERE user_id = ? AND created_at >= datetime('now', ?)`,
      )
      .get(userId, `-${days} days`) as { calls: number; inputTokens: number; outputTokens: number };
    return row;
  },

  /** Per user and operation over the trailing N days - see GET /api/admin/usage. */
  summaryByUser(days: number): { user_id: number; name: string | null; jid: string; operation: string; uses: number; input_units: number; output_units: number }[] {
    return db
      .prepare(
        `SELECT a.user_id, u.name, u.jid, a.operation, COUNT(*) AS uses,
                COALESCE(SUM(a.input_tokens), 0) AS input_units, COALESCE(SUM(a.output_tokens), 0) AS output_units
         FROM ai_usage a JOIN users u ON u.id = a.user_id
         WHERE a.created_at >= datetime('now', ?)
         GROUP BY a.user_id, a.operation ORDER BY u.name, a.operation`,
      )
      .all(`-${days} days`) as { user_id: number; name: string | null; jid: string; operation: string; uses: number; input_units: number; output_units: number }[];
  },
};
