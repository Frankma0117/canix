import { normalizeMessageContent, type WAMessage } from 'baileys';

export interface ParsedVcard {
  name: string;
  /** Digits only, international format - see the waid= preference below. */
  phone: string;
  /** The card carried WhatsApp's own id for that number, so it's a WhatsApp account for sure. */
  onWhatsApp: boolean;
}

/**
 * Parses one WhatsApp-shared contact card's vCard text - pulls the display name (FN, or N when
 * there's no FN) and phone number (TEL). Prefers the `waid=` parameter WhatsApp itself attaches to
 * the TEL line (already the exact digits it uses to address that account) over the
 * human-formatted TEL value, which can have spaces/dashes/parentheses or be missing the country
 * code depending on how the sharer saved it on their own phone. Phones write the lines in several
 * shapes ("TEL;type=CELL:", "item1.TEL;waid=...:", "tel:"), all accepted.
 */
export function parseVcard(vcard: string, fallbackName?: string | null): ParsedVcard | null {
  const waidMatch = vcard.match(/waid=(\d+)/i);
  const telMatch = vcard.match(/^(?:item\d+\.)?TEL[^:\n]*:(.+)$/im);
  const phone = waidMatch?.[1] ?? telMatch?.[1]?.replace(/\D/g, '');
  if (!phone || phone.length < 7) return null;

  const fn = vcard.match(/^(?:item\d+\.)?FN[^:\n]*:(.*)$/im)?.[1]?.trim();
  // "N:Apellido;Nombre;;;" -> "Nombre Apellido"
  const n = vcard.match(/^(?:item\d+\.)?N[^:\n]*:(.*)$/im)?.[1];
  const fromN = n ? n.split(';').slice(0, 2).reverse().map((part) => part.trim()).filter(Boolean).join(' ') : '';
  const name = fn || fallbackName?.trim() || fromN || 'Contacto sin nombre';
  return { name, phone, onWhatsApp: !!waidMatch };
}

/**
 * Extracts every contact card out of an incoming message, whether it's a single shared contact
 * (contactMessage) or several shared at once (contactsArrayMessage) - see bot-manager.ts, which
 * treats both the same way from here on. Skips any card whose vCard doesn't parse instead of
 * failing the whole batch, so one bad card can't block the rest.
 */
export function extractSharedContacts(message: WAMessage): ParsedVcard[] {
  // Same ephemeral/view-once unwrapping as wa-manager.ts's message parsing - a shared contact sent
  // in a chat with disappearing messages on would otherwise be invisible here.
  const content = normalizeMessageContent(message.message);
  const single = content?.contactMessage;
  const array = content?.contactsArrayMessage;
  const cards = single ? [single] : (array?.contacts ?? []);

  const parsed: ParsedVcard[] = [];
  for (const card of cards) {
    if (!card.vcard) continue;
    const result = parseVcard(card.vcard, card.displayName);
    if (result) parsed.push(result);
  }
  return parsed;
}
