/** Token/cost visibility for Fashion Mode's AI calls (see services/fashion/outfit/recommendation.service.ts
 *  and services/fashion/outfit/intent.ts) - separate from the general [LLM] console log in agent.ts. */
/** @public - domain record shape, read by its model. */
export interface AiUsage {
  id: number;
  user_id: number | null;
  operation: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}
