import { CATEGORIES_BY_TYPE } from './taxonomy.js';
import type { GarmentType } from './taxonomy.js';

/**
 * Turns the underscore_case taxonomy values into readable Spanish ("azul_marino" -> "azul marino").
 * Deliberately generic (no hand-maintained label dictionary per value) - every taxonomy array in
 * taxonomy.ts is already lowercase Spanish words/phrases joined by underscores, so this covers all
 * of them without a second list to keep in sync. Category alone gets its nicer, already-capitalized
 * `label` from CATEGORIES_BY_TYPE instead (see categoryLabel below).
 */
function humanize(value: string): string {
  return value.replace(/_/g, ' ');
}

function categoryLabel(type: string | null | undefined, category: string | null | undefined): string {
  if (!category) return 'Prenda';
  const match = type ? CATEGORIES_BY_TYPE[type as GarmentType]?.find((c) => c.value === category) : undefined;
  return match?.label ?? humanize(category);
}

/** Everything a description can draw from - a subset of GarmentDraft/Garment's own fields, kept as
 *  its own narrow interface so this module doesn't need to import either (avoids a circular import
 *  between types.ts and this file, and works the same whether called on a fresh draft or an
 *  already-saved Garment row). */
export interface DescribableGarment {
  type?: string | null;
  category?: string | null;
  color?: string | null;
  secondaryColors?: string[] | null;
  pattern?: string | null;
  material?: string | null;
  fit?: string | null;
  style?: string[] | null;
  formality?: string | null;
  neckline?: string | null;
  sleeves?: string | null;
  closure?: string | null;
  pockets?: string | null;
  length?: string | null;
}

/**
 * Both descriptions below are assembled ENTIRELY from already-validated structured fields (each one
 * either detected by the CLIP model above its confidence floor, or typed in by hand and normalized
 * against the same taxonomy) - never free-generated text. This is a deliberate, honest substitute
 * for genuine natural-language generation, which CLIP zero-shot classification cannot do (it only
 * ever returns "best-matching label from a fixed list", never prose) - see the architecture
 * decision to keep the free local model instead of adding a paid multimodal API. A field that's
 * null/unknown simply doesn't appear in the sentence; nothing is ever invented to fill a gap.
 */
export function buildShortDescription(g: DescribableGarment): string {
  const parts = [categoryLabel(g.type, g.category)];
  if (g.color) parts.push(humanize(g.color));
  if (g.sleeves && g.sleeves !== 'sin_mangas') parts.push(`de ${humanize(g.sleeves)}`);
  return parts.join(' ');
}

export function buildLongDescription(g: DescribableGarment): string {
  const sentences: string[] = [];

  let s1 = categoryLabel(g.type, g.category);
  if (g.sleeves) s1 += ` de ${humanize(g.sleeves)}`;
  if (g.color) {
    s1 += g.secondaryColors?.length
      ? `, en tono ${humanize(g.color)} con detalles en ${g.secondaryColors.map(humanize).join(' y ')}`
      : `, en tono ${humanize(g.color)}`;
  }
  if (g.pattern) s1 += g.pattern === 'liso' ? ', de diseño liso' : `, con diseño ${humanize(g.pattern)}`;
  sentences.push(`${s1}.`);

  const structuralBits: string[] = [];
  if (g.fit) structuralBits.push(`corte ${humanize(g.fit)}`);
  if (g.neckline && g.neckline !== 'sin_cuello') structuralBits.push(`cuello ${humanize(g.neckline)}`);
  if (g.closure && g.closure !== 'sin_cierre_visible') structuralBits.push(`cierre de ${humanize(g.closure)}`);
  if (g.pockets && g.pockets !== 'sin_bolsillos_visibles') structuralBits.push(`${humanize(g.pockets)}`);
  if (g.length) structuralBits.push(`largo ${humanize(g.length)}`);
  if (structuralBits.length) sentences.push(`Presenta ${structuralBits.join(', ')}.`);

  // Material is always phrased as a visual estimate, never a fact - a photo alone can't confirm
  // exact fiber content (see the user's own "no afirmar 100% algodón sin evidencia" requirement).
  if (g.material) sentences.push(`La textura visual es compatible con ${humanize(g.material)}.`);

  const styleBits = [...(g.style ?? []).map(humanize)];
  if (g.formality) styleBits.push(humanize(g.formality));
  if (styleBits.length) sentences.push(`Por su diseño, es una prenda de estilo ${styleBits.join(', ')}.`);

  return sentences.join(' ');
}
