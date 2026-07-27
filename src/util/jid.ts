/** Normalizes a phone number (any format) into a WhatsApp JID: "300 123 4567" -> "3001234567@s.whatsapp.net". */
export function phoneToJid(phone: string): string {
  const digitsOnly = phone.trim().replace(/\D/g, '');
  return `${digitsOnly}@s.whatsapp.net`;
}

/** Extracts the phone number from a phone-addressed JID. LIDs ("...@lid") don't carry the phone, so they return null. */
export function jidToPhone(jid: string): string | null {
  return jid.endsWith('@s.whatsapp.net') ? jid.slice(0, -'@s.whatsapp.net'.length) : null;
}

/** True if the string already looks like a JID (has an "@" domain part). */
export function isJid(value: string): boolean {
  return value.includes('@');
}

/** Detects the first http(s) URL in free text, if any. */
export function extractUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/\S+/i);
  return match?.[0];
}
