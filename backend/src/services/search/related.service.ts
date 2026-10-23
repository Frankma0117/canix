import { linksModel } from '../../models/links.model.js';
import { categoriesModel } from '../../models/categories.model.js';
import { recipesModel } from '../../models/recipes.model.js';
import { linkIcon } from '../../agent/views.js';
import type { Link, Recipe } from '../../entities/index.js';

/**
 * "Sugiéreme de lo que tengo": finds what the person already saved (links, recipes) that has to do
 * with a topic - a routine being created, the ingredients for a recipe, "algo para la cena" - so
 * Canix offers their own material before inventing something new. Purely local word matching, no
 * AI call: a saved item matches when its title/description/category shares meaningful words with
 * the topic.
 */

const plain = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]/g, ' ');

const STOPWORDS = new Set(
  ('para con sin por que una uno unos unas los las del como mas pero todo todos todas cada esta este esto estos estas ' +
    'tengo quiero dame hazme algo cosa cosas hacer rutina dias semana minutos hora horas manana tarde noche ' +
    'link links video videos https http www com').split(' '),
);

/** Meaningful words of a text (accents dropped, a trailing plural "s" too, so "huevos" finds "huevo"). */
function keywordsOf(text: string): string[] {
  const words = plain(text)
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
    .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w));
  return [...new Set(words)];
}

function overlap(haystack: string, keywords: string[]): number {
  const text = plain(haystack);
  return keywords.filter((k) => text.includes(k)).length;
}

/** Food-ish link categories ("Comidas", "Recetas", "Cocina"...) - their links count for any meal topic. */
export const FOOD_CATEGORY_RE = /comid|receta|cocin|aliment|desayun|almuerz|cena|onces|merienda|snack|postre|nutri|dieta/;

export function relatedLinks(userId: number, topic: string, opts: { categoryHint?: RegExp; limit?: number } = {}): Link[] {
  const keywords = keywordsOf(topic);
  const categories = new Map(categoriesModel.listAll(userId).map((c) => [c.id, c.name]));
  return linksModel
    .listByCategory(userId)
    .map((link) => {
      const category = link.category_id ? (categories.get(link.category_id) ?? '') : '';
      let score = overlap(`${link.title ?? ''} ${link.description ?? ''} ${category}`, keywords);
      if (opts.categoryHint?.test(plain(category))) score += 0.5;
      return { link, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.link.last_used_at ?? '').localeCompare(b.link.last_used_at ?? ''))
    .slice(0, opts.limit ?? 3)
    .map((x) => x.link);
}

export function relatedRecipes(userId: number, topic: string, opts: { exclude?: number[]; limit?: number } = {}): Recipe[] {
  const keywords = keywordsOf(topic);
  if (keywords.length === 0) return [];
  return recipesModel
    .listAll(userId)
    .filter((r) => !opts.exclude?.includes(r.id))
    .map((recipe) => ({ recipe, score: overlap(`${recipe.title} ${recipe.ingredients}`, keywords) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 3)
    .map((x) => x.recipe);
}

/** The "de lo que ya tienes guardado" block, or [] when nothing matches. */
export function savedSuggestionLines(links: Link[], recipes: Recipe[]): string[] {
  const lines: string[] = [];
  if (recipes.length) {
    lines.push('', '📖 *De tus recetas guardadas*');
    for (const r of recipes) lines.push(`- ${r.title.replace(/\*/g, '')} ⟦${r.id}⟧`);
  }
  if (links.length) {
    lines.push('', '🔗 *De tus links guardados*');
    for (const l of links) lines.push(`${linkIcon(l.url)} ${(l.title || l.description || 'Link').replace(/\*/g, '')}\n${l.url}`);
  }
  return lines;
}
