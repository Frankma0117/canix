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
};
