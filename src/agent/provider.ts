import OpenAI from 'openai';
import { env } from '../config/env.js';

/**
 * Hard cap per model call. The OpenAI SDK's own default is 10 MINUTES with 2 silent internal
 * retries - a provider that hangs (DeepSeek does, under load) left the chat with no reply for
 * minutes, which is exactly the "dejó de responderme" symptom. ai-agent.ts's callModelWithRetry
 * already does one explicit retry, so the SDK's hidden ones are turned off: worst case is now
 * ~2 x 45s before the user gets a clear "problema técnico" message instead of silence.
 */
const AI_REQUEST_TIMEOUT_MS = 45_000;

/**
 * Builds an OpenAI-compatible client from .env (works for OpenAI, OpenRouter,
 * Groq, DeepSeek, etc. - anything with an OpenAI-compatible /chat/completions).
 */
export function getAiClient(): { client: OpenAI; model: string } {
  if (!env.ai.apiKey) {
    throw new Error('No hay API key de IA configurada. Agrega AI_API_KEY en .env.');
  }
  const client = new OpenAI({
    apiKey: env.ai.apiKey,
    baseURL: env.ai.baseUrl,
    timeout: AI_REQUEST_TIMEOUT_MS,
    maxRetries: 0,
  });
  return { client, model: env.ai.model };
}
