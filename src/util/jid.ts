import { env } from '../config/env.js';

/**
 * Normalizes a phone number (any format) into a WhatsApp JID: "300 123 4567" -> jid. WhatsApp
 * jids need the *full* international number (country code included) to route correctly - a
 * number typed/saved without it produces a jid nobody can actually be messaged at. If the digits
 * look "local" (shorter than a full international number and not already starting with the
 * configured default country code), prepend that default (see WA_SESSION's defaultCountryCode /
 * DEFAULT_COUNTRY_CODE env var).
 */
export function phoneToJid(phone: string): string {
  const digitsOnly = phone.trim().replace(/\D/g, '');
  return `${withCountryCode(digitsOnly)}@s.whatsapp.net`;
}

function withCountryCode(digits: string): string {
  const cc = env.wa.defaultCountryCode;
  if (!cc || digits.startsWith(cc) || digits.length > 10) return digits;
  return `${cc}${digits}`;
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
