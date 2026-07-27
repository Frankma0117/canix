import OpenAI from 'openai';
import { env } from '../config/env.js';

/**
 * Builds an OpenAI-compatible client from .env (works for OpenAI, OpenRouter,
 * Groq, DeepSeek, etc. - anything with an OpenAI-compatible /chat/completions).
 */
export function getAiClient(): { client: OpenAI; model: string } {
  if (!env.ai.apiKey) {
    throw new Error('No hay API key de IA configurada. Agrega AI_API_KEY en .env.');
  }
  const client = new OpenAI({ apiKey: env.ai.apiKey, baseURL: env.ai.baseUrl });
  return { client, model: env.ai.model };
}
