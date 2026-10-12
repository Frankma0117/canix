import { contactsRepo } from '../db/repositories/contacts.repo.js';
import { phoneToJid } from '../util/jid.js';
import { footnote } from '../util/wa-format.js';
import { idChip, prettyPhone } from './views.js';
import type { ParsedVcard } from '../util/vcard.js';

interface ContactChecker {
  checkOnWhatsApp(jid: string): Promise<boolean | null>;
  prefetchLid(jid: string): Promise<string | null>;
}

/** Raw command a 👎 on the confirmation counts as (see bot-manager.ts) - removes what was just saved. */
export const UNDO_CONTACTS_COMMAND = '/quitar-contactos';

/**
 * Saves the contact card(s) someone shared, right away, and builds the confirmation. Sharing a
 * card IS the request to save it: the earlier flow asked "¿los guardo?" and kept the cards waiting
 * for an exact "sí", which lost them whenever the answer was worded any other way, and each new
 * card replaced the ones still waiting. `newIds` are the contacts that didn't exist before - the
 * only ones an undo should remove.
 */
export async function saveSharedContacts(wa: ContactChecker, userId: number, cards: ParsedVcard[]): Promise<{ text: string; newIds: number[] }> {
  const rows: string[] = [];
  const newIds: number[] = [];
  const names: string[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    const jid = phoneToJid(card.phone);
    if (seen.has(jid)) continue;
    seen.add(jid);

    const existing = contactsRepo.getByJid(userId, jid);
    const contact = contactsRepo.upsert(userId, card.name, jid, null);
    if (!existing) newIds.push(contact.id);
    names.push(contact.name);

    // A card that came with WhatsApp's own id is a WhatsApp account for sure; a bare phone number
    // is checked, so a number missing its country code is caught now, not when messaging fails.
    const exists = card.onWhatsApp ? true : await wa.checkOnWhatsApp(jid);
    void wa.prefetchLid(jid);

    const note = exists === false ? 'ese número no aparece en WhatsApp: revisa que tenga el indicativo del país' : existing ? (existing.name !== contact.name ? `ya lo tenías como "${existing.name}", actualicé el nombre` : 'ya lo tenías guardado') : null;
    rows.push(`👤 *${contact.name.replace(/\*/g, '')}* · ${prettyPhone(jid.split("@")[0])} ${idChip(contact.id)}${note ? `\n> ${note}` : ''}`);
  }

  const count = rows.length;
  const title = newIds.length === 0 ? (count === 1 ? 'Ese contacto ya estaba' : 'Esos contactos ya estaban') : count === 1 ? 'Contacto guardado' : `${count} contactos guardados`;
  const hints = [`Ya puedes decirme "escríbele a ${names[0]}"`];
  if (newIds.length > 0) hints.push(`Reacciona 👎 a este mensaje para ${newIds.length === 1 ? 'quitarlo' : 'quitarlos'}`);
  return { text: `📇 *${title}*\n\n${rows.join('\n')}\n\n${footnote(...hints)}`, newIds };
}

/** Undo of saveSharedContacts: removes those contacts (only this person's own). Returns the confirmation. */
export function undoSharedContacts(userId: number, ids: number[]): string {
  const removed: string[] = [];
  for (const id of ids) {
    const contact = contactsRepo.getById(userId, id);
    if (!contact) continue;
    contactsRepo.remove(userId, id);
    removed.push(contact.name);
  }
  if (removed.length === 0) return 'Esos contactos ya no estaban guardados.';
  return `🗑️ Listo, quité ${removed.length === 1 ? `a *${removed[0]}*` : `${removed.length} contactos: ${removed.join(', ')}`}.`;
}
