import type { Tool } from '../tool-registry.js';
import { resolveActingUser } from './act-on-behalf.js';
import { FOOD_CATEGORY_RE, relatedLinks, relatedRecipes, savedSuggestionLines } from '../related.js';

/**
 * "Quiero una rutina de abdomen", "algo para la cena", "qué tengo de skincare": before proposing
 * something new, look at what the person already saved on the subject (see related.ts).
 */
export const findSavedTool: Tool = {
  name: 'find_saved',
  description:
    'Busca en lo que YA tengo guardado (links y recetas) lo relacionado con un tema, para sugerírmelo. Úsala ANTES ' +
    'de proponer algo tuyo cuando pido una rutina, ejercicio, comida, receta, plan o ideas sobre un tema ' +
    '("quiero una rutina de abdomen", "qué hago de cena", "algo de skincare"): primero lo mío, después lo tuyo. ' +
    'Devuelve lo encontrado ya diseñado (o que no hay nada).',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'El tema con sus palabras clave (ej. "rutina abdomen ejercicio", "cena pollo").' },
      food: { type: 'boolean', description: 'true si el tema es de comida (prioriza categorías de comidas/recetas).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para buscar en lo de ella.',
      },
    },
    required: ['topic'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;

    const topic = String(args.topic ?? '').trim();
    if (!topic) return 'Me falta el tema.';
    const links = relatedLinks(acting.userId, topic, { categoryHint: args.food ? FOOD_CATEGORY_RE : undefined, limit: 5 });
    const recipes = args.food ? relatedRecipes(acting.userId, topic, { limit: 5 }) : [];
    if (links.length + recipes.length === 0) return `No tienes nada guardado sobre "${topic}" (ni links ni recetas). Sugiere tú algo y ofrécele guardarlo.`;
    return [`🔎 *Lo que ya tienes sobre ${topic}*`, ...savedSuggestionLines(links, recipes)].join('\n');
  },
};
