import type { WAMessage } from 'baileys';

export interface ParsedVcard {
  name: string;
  /** Digits only, international format - see the waid= preference below. */
  phone: string;
}

/**
 * Parses one WhatsApp-shared contact card's vCard text - pulls the display name (FN) and phone
 * number (TEL). Prefers the `waid=` parameter WhatsApp itself attaches to the TEL line (already
 * the exact digits it uses to address that account) over the human-formatted TEL value, which can
 * have spaces/dashes/parentheses or be missing the country code depending on how the sharer saved
 * it on their own phone.
 */
export function parseVcard(vcard: string, fallbackName?: string | null): ParsedVcard | null {
  const waidMatch = vcard.match(/waid=(\d+)/);
  const telMatch = vcard.match(/^TEL[^:]*:(.+)$/m);
  const phone = waidMatch?.[1] ?? telMatch?.[1]?.replace(/\D/g, '');
  if (!phone) return null;

  const fnMatch = vcard.match(/^FN:(.*)$/m);
  const name = fnMatch?.[1]?.trim() || fallbackName?.trim() || 'Contacto sin nombre';
  return { name, phone };
}

/**
 * Extracts every contact card out of an incoming message, whether it's a single shared contact
 * (contactMessage) or several shared at once (contactsArrayMessage) - see bot-manager.ts, which
 * treats both the same way from here on. Skips any card whose vCard doesn't parse instead of
 * failing the whole batch, so one bad card can't block the rest.
 */
export function extractSharedContacts(message: WAMessage): ParsedVcard[] {
  const single = message.message?.contactMessage;
  const array = message.message?.contactsArrayMessage;
  const cards = single ? [single] : (array?.contacts ?? []);

  const parsed: ParsedVcard[] = [];
  for (const card of cards) {
    if (!card.vcard) continue;
    const result = parseVcard(card.vcard, card.displayName);
    if (result) parsed.push(result);
  }
  return parsed;
}
