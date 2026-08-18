/**
 * Separate, minimal prompts per responsibility (intent classification vs. outfit recommendation) -
 * deliberately NOT one universal prompt, per the user's own explicit requirement ("reduce tokens
 * de DeepSeek... separar responsabilidades"). Both request strict JSON (response_format:
 * json_object) and are built from taxonomy.ts's own arrays, never a second hardcoded copy of the
 * enum lists, so they can't drift.
 */
import { OCCASIONS, FORMALITY, SEASONS, WEATHER, STYLES } from '../taxonomy.js';

export function buildIntentPrompt(text: string): string {
  return `Convierte esta petición de outfit a JSON, usando SOLO estos valores permitidos (o null si no se puede inferir):
occasion: ${OCCASIONS.join('|')}|null
formality: ${FORMALITY.join('|')}|null
season: ${SEASONS.join('|')}|null
weather: ${WEATHER.join('|')}|null
style: ${STYLES.join('|')}|null
colorsPreferred: array de strings (puede ser vacío)
colorsAvoided: array de strings (puede ser vacío)

Responde SOLO con este JSON exacto, sin texto adicional:
{"occasion":null,"formality":null,"season":null,"weather":null,"style":null,"colorsPreferred":[],"colorsAvoided":[]}

Petición: "${text}"`;
}

interface CandidateForPrompt {
  id: number;
  category: string;
  color: string | null;
  style: string | null;
}

export function buildRecommendationPrompt(
  context: { occasion?: string; formality?: string; season?: string; weather?: string; style?: string },
  candidatesByRole: Record<string, CandidateForPrompt[]>,
  avoidCombos: string[],
): string {
  const contextLine = Object.entries(context)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');

  const candidateLines = Object.entries(candidatesByRole)
    .filter(([, list]) => list.length > 0)
    .map(([role, list]) => `${role}: ${list.map((c) => `{id:${c.id},cat:${c.category},color:${c.color ?? '?'}}`).join(', ')}`)
    .join('\n');

  const avoidLine = avoidCombos.length ? `\nYa mostraste estas combinaciones, da una DIFERENTE: ${avoidCombos.join(' | ')}` : '';

  return `Eres un motor de recomendación de outfits. Elige la mejor combinación con los candidatos dados.
Contexto: ${contextLine || '(sin restricciones específicas)'}
Candidatos por rol (SOLO puedes usar estos ids, nunca inventes uno):
${candidateLines}${avoidLine}

Reglas: usa TOP+BOTTOM o FULL_BODY, nunca ambos a la vez. FOOTWEAR siempre que haya candidatos. OUTERWEAR y ACCESSORY son opcionales.

Responde SOLO con este JSON exacto, sin texto adicional:
{"picks":[{"garmentId":0,"role":"TOP"}],"reason":"una frase corta explicando por qué"}`;
}
