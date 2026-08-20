import { env } from '../config/env.js';

/**
 * Normalizes and validates a phone number for Twilio Voice - E.164 requires a leading "+" followed
 * by 8 to 15 digits, no spaces/dashes/parentheses (see https://www.twilio.com/docs/glossary/what-e164).
 * Accepts human-formatted input ("+57 300 123 4567", "(300) 123-4567") and strips it down; a number
 * given without a country code is rejected rather than guessed at, unlike util/jid.ts's
 * phoneToJid() - a wrong guess here places a real, billed phone call to the wrong country, not
 * just a WhatsApp message that silently never arrives.
 */
export function toE164(phone: string): string | null {
  const trimmed = phone.trim();
  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (!hadPlus || digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

/**
 * Blocks a destination number from being set to Twilio's own caller-id number - prevents a user
 * from making the bot call the Twilio number itself (e.g. to loop calls back at no real
 * destination, or probe the account's own number). Always applied on top of toE164() above.
 */
export function isCallableDestination(e164Phone: string): boolean {
  return e164Phone !== env.twilio.phoneNumber;
}

/** "+573001234567" -> "+5730******67" - enough to recognize a number in logs without ever writing
 *  a full, dialable phone number to disk in plain text (see the user's explicit logging requirement). */
export function maskPhone(e164Phone: string): string {
  if (e164Phone.length <= 6) return '***';
  return `${e164Phone.slice(0, 5)}${'*'.repeat(Math.max(0, e164Phone.length - 7))}${e164Phone.slice(-2)}`;
}
