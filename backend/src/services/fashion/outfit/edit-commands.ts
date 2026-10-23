import { plainText, takeWords, CATEGORY_WORDS, COLOR_WORDS, TYPE_WORDS } from './request.js';
import { typeForCategory } from '../taxonomy.js';
import type { Garment } from '../../../entities/index.js';
import type { OutfitPick } from './rules.js';

/**
 * An edit to the outfit on screen, said in words instead of with a reaction:
 *   swap       "cambia la camiseta", "otros zapatos", "no me gusta el pantalón"
 *   keep_only  "deja solo el pantalón", "arma otro con esa camisa", "mantén los tenis y cambia lo demás"
 *   delete     "elimina la camiseta de mi armario", "ya no tengo esos zapatos"
 * The garment is found among the outfit's own pieces - by kind ("camiseta"), by body part ("lo de
 * arriba") or by color ("la blanca"). Anything that doesn't clearly name one piece is not an edit.
 */
export type OutfitEdit = { kind: 'swap' | 'keep_only' | 'delete'; garmentId: number };

const DELETE_RE = /\b(elimina(la|lo|las|los)?|borra(la|lo|las|los)?|saca(la|lo|las|los)?|quita(la|lo|las|los)?)\b.*\b(armario|closet|guardad[oa]s?)\b|\bya no (la |lo |las |los )?(tengo|uso|me queda|me quedan)\b|\bse me (dano|daño|perdio|perdió)\b|\b(regale|regalé|bote|boté|vendi|vendí)\b/;
const KEEP_ONLY_RE = /\b(deja(me)?|manten(me)?|conserva|quiero|usa)\b.*\b(solo|solamente|unicamente|nada mas)\b|\b(solo|solamente) (deja|manten|conserva)\b|\b(cambia|cambiame) (lo demas|el resto|todo lo demas|todo menos)\b|\b(lo demas|el resto)\b.*\b(cambia|cambialo|nuevo)\b|\barma(me)? (otro|uno|un outfit|otra pinta) con\b|\b(deja|manten|conserva)\b/;
const SWAP_RE = /\b(cambia(la|lo|las|los|me)?|cambiar|reemplaza(la|lo|las|los)?|otr[oa]s?|no me gusta(n)?|no me convence(n)?|no (la|lo|las|los) quiero|pon(me)? (otra|otro|otras|otros))\b/;

const ROLE_WORDS: [RegExp, Garment['type']][] = [
  [/\b(arriba|superior|parte de arriba|lo de arriba|la de arriba)\b/, 'TOP'],
  [/\b(abajo|inferior|parte de abajo|lo de abajo|la de abajo)\b/, 'BOTTOM'],
  [/\b(calzado|zapatos|los pies)\b/, 'FOOTWEAR'],
  [/\b(chaqueta|abrigo|encima)\b/, 'OUTERWEAR'],
];

/** Which of the outfit's pieces the text points at, or undefined when it names none (or several). */
function referencedGarment(text: string, picks: OutfitPick[], garments: Garment[]): Garment | undefined {
  const pieces = picks.map((p) => garments.find((g) => g.id === p.garmentId)).filter((g): g is Garment => !!g);
  const unique = (list: Garment[]) => (list.length === 1 ? list[0] : undefined);

  const categories = takeWords(text, CATEGORY_WORDS).found.map((f) => f.value);
  for (const category of categories) {
    const byCategory = unique(pieces.filter((g) => g.category === category));
    if (byCategory) return byCategory;
    const role = typeForCategory(category);
    const byRole = role ? unique(pieces.filter((g) => g.type === role)) : undefined;
    if (byRole) return byRole;
  }
  for (const type of takeWords(text, TYPE_WORDS).found.map((f) => f.value)) {
    const byType = unique(pieces.filter((g) => g.type === type));
    if (byType) return byType;
  }
  for (const [re, role] of ROLE_WORDS) {
    if (re.test(text)) {
      const byRole = unique(pieces.filter((g) => g.type === role));
      if (byRole) return byRole;
    }
  }
  for (const color of takeWords(text, COLOR_WORDS).found.map((f) => f.value)) {
    const byColor = unique(pieces.filter((g) => g.color === color));
    if (byColor) return byColor;
  }
  return undefined;
}

export function readOutfitEdit(rawText: string, picks: OutfitPick[], garments: Garment[]): OutfitEdit | null {
  const text = plainText(rawText);
  if (!text || text.split(' ').length > 16) return null;
  const garment = referencedGarment(text, picks, garments);
  if (!garment) return null;
  if (DELETE_RE.test(text)) return { kind: 'delete', garmentId: garment.id };
  // "cambia lo demás" mentions a change too, so keeping wins when both read
  if (KEEP_ONLY_RE.test(text)) return { kind: 'keep_only', garmentId: garment.id };
  if (SWAP_RE.test(text)) return { kind: 'swap', garmentId: garment.id };
  return null;
}
