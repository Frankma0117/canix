import type { Tool } from '../tool-registry.js';
import { recipesRepo } from '../../db/repositories/recipes.repo.js';
import { mealPlansRepo } from '../../db/repositories/meal-plans.repo.js';
import { normalizeDate } from '../../util/datetime.js';
import { resolveActingUser } from './act-on-behalf.js';
import { MEAL_ICON, MEAL_LABEL, MEAL_ORDER, idChip } from '../views.js';
import { FOOD_CATEGORY_RE, relatedLinks, relatedRecipes, savedSuggestionLines } from '../related.js';
import type { MealSlot } from '../../types/index.js';

const SLOTS = MEAL_ORDER as MealSlot[];

interface SuggestedRecipe {
  title: string;
  meal_slot?: string;
  ingredients: string;
  instructions: string;
  missing?: string;
}

/**
 * Recipe/meal suggestions: the model writes the ideas (from what the person has, or for each meal
 * of the day), and this tool keeps them in the person's recipes, optionally drops them into the
 * meal plan, and adds what they already had saved on the subject (recipes, food links) - one call,
 * one message ready to send.
 */
export const suggestRecipesTool: Tool = {
  name: 'suggest_recipes',
  description:
    'Sugiere recetas o comidas y las deja guardadas en mis recetas. Úsala cuando: (1) te digo qué ingredientes ' +
    'tengo y quiero saber qué preparar, o (2) te pido ideas de comidas (desayuno, onces, almuerzo, media tarde, ' +
    'cena) para hoy, para un día o para una comida. Tú escribes las recetas con tu conocimiento: con ingredientes ' +
    'que te di, usa SOLO esos más lo básico de cocina (sal, aceite, agua, azúcar, especias) - lo demás va en ' +
    '"missing". Para ideas del día, una receta por cada comida pedida (meal_slot). La tool las guarda en Recetas, ' +
    'busca lo relacionado que ya tengo guardado (recetas y links de comida) y devuelve el mensaje ya diseñado: ' +
    'envíalo TAL CUAL.',
  parameters: {
    type: 'object',
    properties: {
      ingredients_available: {
        type: 'string',
        description: 'Los ingredientes que dije que tengo, tal cual (vacío si solo pedí ideas de comidas).',
      },
      recipes: {
        type: 'array',
        description: '2-3 recetas con lo que tengo, o una por cada comida pedida.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Nombre del plato.' },
            meal_slot: { type: 'string', enum: SLOTS, description: 'Para qué comida es.' },
            ingredients: { type: 'string', description: 'Ingredientes con cantidades aproximadas, separados por coma.' },
            instructions: { type: 'string', description: 'Pasos cortos y numerados ("1. ... 2. ...").' },
            missing: { type: 'string', description: 'Lo que haría falta comprar, si algo (opcional).' },
          },
          required: ['title', 'ingredients', 'instructions'],
          additionalProperties: false,
        },
      },
      plan_date: {
        type: 'string',
        description: "Solo si pedí que además las ponga en mi plan de comidas: fecha 'YYYY-MM-DD'.",
      },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para sugerírselas a ella.',
      },
    },
    required: ['recipes'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const have = String(args.ingredients_available ?? '').trim();
    const recipes = (Array.isArray(args.recipes) ? (args.recipes as SuggestedRecipe[]) : [])
      .map((r) => ({
        title: String(r.title ?? '').trim(),
        slot: SLOTS.includes(r.meal_slot as MealSlot) ? (r.meal_slot as MealSlot) : null,
        ingredients: String(r.ingredients ?? '').trim(),
        instructions: String(r.instructions ?? '').trim(),
        missing: String(r.missing ?? '').trim(),
      }))
      .filter((r) => r.title && r.ingredients && r.instructions)
      .sort((a, b) => (a.slot ? SLOTS.indexOf(a.slot) : 99) - (b.slot ? SLOTS.indexOf(b.slot) : 99));
    if (recipes.length === 0) return 'Me faltan las recetas (título, ingredientes y pasos).';

    const planDate = args.plan_date ? normalizeDate(String(args.plan_date)).slice(0, 10) : null;

    // Saved under Recetas - the same title isn't saved twice, the existing one is reused.
    const existing = recipesRepo.listAll(userId);
    const savedIds: number[] = [];
    const lines = [have ? '👩‍🍳 *Ideas con lo que tienes*' : '🍽️ *Ideas de comidas*'];
    if (have) lines.push(`> Tienes: ${have}`);

    for (const r of recipes) {
      const same = existing.find((e) => e.title.trim().toLowerCase() === r.title.toLowerCase());
      const id = same?.id ?? recipesRepo.create(userId, { title: r.title, ingredients: r.ingredients, instructions: r.instructions, categoryId: null });
      savedIds.push(id);
      if (planDate && r.slot) mealPlansRepo.create(userId, { planDate, mealSlot: r.slot, title: r.title, notes: `Receta #${id}` });

      const head = r.slot ? `${MEAL_ICON[r.slot]} *${MEAL_LABEL[r.slot]} · ${r.title.replace(/\*/g, '')}*` : `🍴 *${r.title.replace(/\*/g, '')}*`;
      lines.push('', `${head} ${idChip(id)}`, `🧺 ${r.ingredients}`);
      if (r.missing) lines.push(`🛒 Te falta: ${r.missing}`);
      lines.push(r.instructions);
    }

    const topic = [have, ...recipes.map((r) => `${r.title} ${r.slot ? MEAL_LABEL[r.slot] : ''}`)].join(' ');
    lines.push(
      ...savedSuggestionLines(relatedLinks(userId, topic, { categoryHint: FOOD_CATEGORY_RE }), relatedRecipes(userId, topic, { exclude: savedIds })),
    );

    lines.push('', `> 📖 Quedaron en tus recetas${planDate ? ` y en tu plan de comidas del ${planDate}` : ''}`);
    if (!planDate) lines.push('> Si quieres, te las pongo en el plan de comidas de un día');
    return lines.join('\n');
  },
};
