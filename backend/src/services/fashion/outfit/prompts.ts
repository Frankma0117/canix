/**
 * Separate, minimal prompts per responsibility (intent classification vs. outfit recommendation)
 * instead of one universal prompt, to keep model tokens low. Both request strict JSON
 * (response_format: json_object) and are built from taxonomy.ts's own arrays, never a second
 * hardcoded copy of the enum lists, so they can't drift.
 */
import { OCCASIONS, FORMALITY, SEASONS, WEATHER, STYLES, allCategoryValues } from '../taxonomy.js';

export function buildIntentPrompt(text: string): string {
  return `Convierte esta petición de outfit a JSON, usando SOLO estos valores permitidos (o null si no se puede inferir):
occasion: ${OCCASIONS.join('|')}|null
formality: ${FORMALITY.join('|')}|null
season: ${SEASONS.join('|')}|null
weather: ${WEATHER.join('|')}|null
style: ${STYLES.join('|')}|null
colorsPreferred: array de strings (puede ser vacío)
colorsAvoided: array de strings (puede ser vacío)
mustHave: prendas que pide incluir, array de {"category": una de ${allCategoryValues().join('|')}, "color": string o null} (puede ser vacío)
excludeCategories: prendas que pide NO usar en ningún color, array de esas mismas categorías (puede ser vacío)
avoid: prenda + color que pide NO usar ("que no tenga camiseta blanca"), array de {"category": una de esas categorías, "color": string} (puede ser vacío)

Responde SOLO con este JSON exacto, sin texto adicional:
{"occasion":null,"formality":null,"season":null,"weather":null,"style":null,"colorsPreferred":[],"colorsAvoided":[],"mustHave":[],"excludeCategories":[],"avoid":[]}

Petición: "${text}"`;
}

interface CandidateForPrompt {
  id: number;
  category: string;
  color: string | null;
  style: string | null;
}

export function buildRecommendationPrompt(
  context: { occasion?: string; formality?: string; season?: string; weather?: string; style?: string; mustHave?: { category: string; color?: string }[] },
  candidatesByRole: Record<string, CandidateForPrompt[]>,
  avoidCombos: string[],
): string {
  const contextLine = Object.entries(context)
    .filter(([, v]) => typeof v === 'string' && v)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  const mustLine = context.mustHave?.length
    ? `\nDEBE incluir estas prendas (elige el candidato de esa categoría): ${context.mustHave.map((m) => `${m.category}${m.color ? ` ${m.color}` : ''}`).join(', ')}`
    : '';

  const candidateLines = Object.entries(candidatesByRole)
    .filter(([, list]) => list.length > 0)
    .map(([role, list]) => `${role}: ${list.map((c) => `{id:${c.id},cat:${c.category},color:${c.color ?? '?'}}`).join(', ')}`)
    .join('\n');

  const avoidLine = avoidCombos.length ? `\nYa mostraste estas combinaciones, da una DIFERENTE: ${avoidCombos.join(' | ')}` : '';

  return `Eres un motor de recomendación de outfits. Elige la mejor combinación con los candidatos dados.
Contexto: ${contextLine || '(sin restricciones específicas)'}${mustLine}
Candidatos por rol (SOLO puedes usar estos ids, nunca inventes uno):
${candidateLines}${avoidLine}

Reglas: usa TOP+BOTTOM o FULL_BODY, nunca ambos a la vez. UNA sola prenda por rol (salvo ACCESSORY). FOOTWEAR siempre que haya candidatos. OUTERWEAR solo si aparece en los candidatos; ACCESSORY es opcional.
Combina colores con criterio: los neutros (negro, blanco, gris, beige, azul_marino, café) van con todo; evita juntar dos colores fuertes distintos o el mismo color fuerte arriba y abajo. Varía: no repitas siempre la primera prenda de cada lista.

Responde SOLO con este JSON exacto, sin texto adicional:
{"picks":[{"garmentId":0,"role":"TOP"}],"reason":"una frase corta explicando por qué"}`;
}
