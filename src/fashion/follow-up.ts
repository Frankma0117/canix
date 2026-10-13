import { parseRequestLocally } from './outfit/request.js';

/**
 * What a message means when it arrives right after an outfit was shown. Before this, anything that
 * mentioned a garment or a color was taken as "adjust this outfit" and answered with another
 * outfit - so asking for something else about clothes ("qué pantalones negros tengo") looped back
 * into outfits. Only what clearly reads as an adjustment is one; the rest goes where it belongs,
 * and what can't be told apart is asked.
 */
export type FollowUp =
  | 'adjust' // "sin chaqueta", "más formal", "con tenis blancos"
  | 'new_outfit' // "ahora un outfit para la oficina"
  | 'wardrobe' // "qué camisas blancas tengo", "muéstrame mis zapatos"
  | 'other' // nothing to do with clothes
  | 'unsure';

const plain = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿?¡!.,;:"]/g, ' ').replace(/\s+/g, ' ').trim();

/** How an adjustment starts: it takes something away, adds it, or pushes the look one way. */
const ADJUST_START_RE =
  /^(y |pero |ok |listo |bueno |mejor |ahora )*(sin|con|mas|menos|nada de|no quiero|no me pongas|que no (sea|tenga|lleve)|quita(le|me)?|pon(le|me)?|agrega(le|me)?|cambia(le|me)?|en vez de|mejor (con|sin|un|una|algo)|algo mas|otro color|otra (camisa|camiseta|chaqueta|prenda)|otros? (zapatos|tenis|pantalon|jeans))\b/;
const NEW_OUTFIT_RE = /\b(outfit|outfits|una pinta|la pinta|que me pongo|que ponerme|que me puedo poner|como me visto|un look|otro look)\b/;
/** Asking about what's in the wardrobe, not for something to wear. */
const WARDROBE_RE = /\b(que|cuales|cuantas|cuantos|muestrame|mostrar|mostrame|ensename|ver|lista|listame|dime|dame la lista)\b.*\b(tengo|hay|guardad[oa]s?|armario|closet|prendas)\b|^(mis|ver mis|muestrame mis|ensename mis) \w+/;
const CLOTHES_WORDS_RE = /\b(ropa|prenda|prendas|ponerme|me pongo|vestir|vestirme|combina|combinar|armario|closet|elegante|formal|informal|casual)\b/;

export function readFollowUp(rawText: string): FollowUp {
  const text = plain(rawText);
  if (!text) return 'other';
  const words = text.split(' ').length;
  const read = parseRequestLocally(rawText);

  if (WARDROBE_RE.test(text) && (read.understood > 0 || /\b(armario|closet|prendas|ropa)\b/.test(text))) return 'wardrobe';
  if (NEW_OUTFIT_RE.test(text)) return 'new_outfit';
  // An adjustment is short and either starts like one or is nothing but outfit vocabulary ("azul", "más formal").
  if (ADJUST_START_RE.test(text) && words <= 10 && (read.understood > 0 || CLOTHES_WORDS_RE.test(text))) return 'adjust';
  if (read.understood > 0 && read.leftover.length === 0 && words <= 5) return 'adjust';

  if (read.understood === 0 && !CLOTHES_WORDS_RE.test(text)) return 'other';
  // A long sentence where a garment or color is just passing by ("recuérdame comprar una camisa blanca mañana").
  if (read.leftover.length > read.understood * 2 && !CLOTHES_WORDS_RE.test(text)) return 'other';
  return 'unsure';
}

/** "qué pantalones negros tengo" -> "pantalones negros": what's left is the wardrobe filter. */
export function wardrobeQuery(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,;:"]/g, ' ')
    .replace(/\b(que|cuales|cuantas|cuantos|muestrame|mostrar|mostrame|ensename|ver|lista|listame|dime|dame|la|las|los|el|de|del|en|mi|mis|tengo|hay|guardadas?|guardados?|armario|closet|prendas|ropa|todas?|todos?|color)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
