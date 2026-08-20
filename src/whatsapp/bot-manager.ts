import { jidNormalizedUser, downloadMediaMessage, type WAMessage } from 'baileys';
import { WaManager } from './wa-manager.js';
import { handleFashionMessage } from '../fashion/router.js';
import { usersRepo } from '../db/repositories/users.repo.js';
import { messagesRepo } from '../db/repositories/messages.repo.js';
import { stickersRepo, normalizeStickerLabel } from '../db/repositories/stickers.repo.js';
import { pendingContactsRepo } from '../db/repositories/pending-contacts.repo.js';
import { contactsRepo } from '../db/repositories/contacts.repo.js';
import { extractSharedContacts } from '../util/vcard.js';
import { phoneToJid } from '../util/jid.js';
import { resetAllUserData } from '../db/reset-user.js';
import { processMessage } from '../agent/ai-agent.js';
import { ensureDailyAgendaReminder } from '../agent/agenda.js';
import { ensureWeeklyReportReminder } from '../agent/weekly-report.js';
import { ensureDailyResetReminder } from '../agent/daily-reset.js';
import { ensureDailyDedupReminder } from '../agent/dedup.js';
import { legacyAdminToken } from '../server/auth.js';
import { renderMainMenu, resolveMenuCategory, renderCategoryDetail, renderUnknownCategory } from '../agent/menu.js';
import { isTwilioConfigured } from '../calls/twilio-client.js';
import { handleModeMessage } from '../agent/modes.js';
import { env } from '../config/env.js';
import { sleep, typingDelayMs, readingPauseMs, withWorkingUpdates } from '../util/human-delay.js';
import { workingUpdateMessage } from '../util/motivational.js';
import { synthesizeVoiceNote } from '../audio/tts.js';

/** How long a turn can run before the user gets a "still working on it" ping, and how many of
 *  those pings a single turn can rack up - see util/human-delay.ts's withWorkingUpdates(). Tuned
 *  so a normal one-or-two-tool-call reply (the vast majority) never triggers this at all; only a
 *  genuinely slow multi-iteration turn or a provider retry does. */
const WORKING_UPDATE_INTERVAL_MS = 12_000;
const WORKING_UPDATE_MAX_TICKS = 3;

const PRIVATE_BOT_REPLY =
  'Este es un asistente personal privado y no tienes acceso todavía. Pídele al administrador que te lo dé. 🙏';

const ERROR_REPLY =
  '⚠️ Tuve un problema técnico procesando tu mensaje. Ya quedó registrado, intenta de nuevo en un ' +
  'momento - si te sigue pasando seguido, avísale al administrador.';

const RESET_ALL_WARNING =
  '⚠️ Esto borra TODO tu contenido: recordatorios, rutinas, contactos, links, notas, categorías, ' +
  'premios/castigos e historial de chat - no se puede deshacer (tu acceso al bot no se toca). ' +
  'Si estás seguro, escribe exactamente:\n\n/reset todo confirmar';

const HELP_TEXT =
  'Comandos disponibles:\n\n' +
  '/menu - menú completo de todo lo que puedo hacer, organizado por categorías.\n' +
  '/reset - borra el historial de esta conversación (empezamos a "hablar" de cero, tu ' +
  'información sigue intacta).\n' +
  '/reset todo - borra TODA tu información (recordatorios, rutinas, contactos, links, notas, ' +
  'categorías, premios/castigos e historial) y empieza de cero. Pide confirmación antes de ' +
  'hacerlo, no se puede deshacer.\n' +
  '/ayuda - muestra este mensaje.\n\n' +
  'Recordatorios y links siempre están activos. Rutinas, tareas, notas, contactos, comidas, ' +
  'premios y resúmenes son modos: escribe su nombre (ej. "rutinas") para entrar y ver su menú, y ' +
  '"salir" para volver. Ve /menu para el detalle de cada uno.\n\n' +
  'Todo lo demás simplemente pídemelo hablando normal, como ya sabes. 🙌';

/**
 * Owns the single WhatsApp session and wires incoming messages to the agent. Multi-user: the
 * first person to ever message this bot becomes its admin (auto-assigned), and the admin can
 * grant access to others (grant_access tool) - everyone else who writes in without access gets a
 * generic rejection. Each user's data (reminders, routines, contacts, etc.) is completely separate.
 */
export class BotManager {
  private wa: WaManager;

  constructor() {
    this.wa = new WaManager(env.wa.session);
    this.wa.onMessage(this.handleIncoming.bind(this));
  }

  get session(): WaManager {
    return this.wa;
  }

  async start(): Promise<void> {
    await this.wa.start();
  }

  /**
   * WhatsApp often hands us the sender's @lid as `remoteJid` instead of their phone jid (privacy
   * routing) - happens for basically everyone these days. Resolve the real phone number whenever
   * that's the case, so `users.jid`/`contacts` always end up with the actual number, not a lid
   * mistakenly stored where the number should be (that was the bug: bootstrap used to store
   * whatever jid showed up as-is, phone number or not). Also normalize away any ":<device>"
   * suffix Baileys' own resolution can attach (e.g. "...:0@s.whatsapp.net") - phoneToJid() never
   * produces one, so a stored jid that has it would silently fail to match a plain-number lookup.
   */
  private async resolveIncomingIdentity(rawJid: string): Promise<{ phoneJid: string; lid: string | null }> {
    if (!rawJid.endsWith('@lid')) return { phoneJid: jidNormalizedUser(rawJid), lid: null };
    const resolved = await this.wa.resolveLidToPhoneJid(rawJid);
    return { phoneJid: jidNormalizedUser(resolved ?? rawJid), lid: rawJid };
  }

  private async handleIncoming({
    jid,
    name,
    text,
    fromAudio,
    imageMessage,
    documentMessage,
    stickerMessage,
    contactMessage,
  }: {
    jid: string;
    name?: string;
    text: string;
    fromAudio?: boolean;
    imageMessage?: WAMessage;
    documentMessage?: WAMessage;
    stickerMessage?: WAMessage;
    contactMessage?: WAMessage;
  }) {
    // Everything below can fail in ways that have nothing to do with the user's message itself
    // (AI provider hiccup, a bug, WhatsApp acting up) - wrapping the whole thing means there is
    // always either a real reply or this error notice, never just silence while they wait.
    try {
      const { phoneJid, lid } = await this.resolveIncomingIdentity(jid);
      console.log(
        '[BOT] Mensaje entrante de %s%s%s: "%s"',
        phoneJid,
        lid ? ` (lid ${lid})` : '',
        fromAudio ? ' [audio]' : '',
        text.length > 200 ? `${text.slice(0, 200)}…` : text,
      );

      if (!usersRepo.hasAny()) {
        const admin = usersRepo.create({ jid: phoneJid, name: name ?? null, role: 'admin' });
        if (lid) usersRepo.setLid(phoneJid, lid);
        ensureDailyAgendaReminder(admin.id, admin.jid);
        ensureWeeklyReportReminder(admin.id, admin.jid);
        ensureDailyResetReminder(admin.id, admin.jid);
        ensureDailyDedupReminder(admin.id, admin.jid);
        // Seeded from the legacy single-token source (env ADMIN_TOKEN or auth_info/admin-token.txt)
        // rather than a fresh random one, so whatever's already printed/configured for the admin
        // works immediately - see server/auth.ts.
        const panelToken = legacyAdminToken();
        usersRepo.setPanelToken(admin.id, panelToken);
        console.log(
          '[SETUP] Administrador registrado: "%s" (jid=%s%s) #%d',
          name ?? '(sin nombre)',
          phoneJid,
          lid ? `, lid=${lid}` : '',
          admin.id,
        );
        // index.ts only prints this token once, right after app.listen() - which fires at boot,
        // *before* this first-ever admin even exists (they're only created here, on their first
        // incoming message). That left the console with nothing to show on a genuinely fresh
        // install - the token is printed here too, at the moment it's actually created, so a
        // first-time setup always sees it somewhere.
        console.log('[AUTH] Token de acceso del administrador: %s', panelToken);
      }

      let user = usersRepo.getByJidOrLid(phoneJid) ?? usersRepo.getByJidOrLid(jid);
      if (user && lid && !user.lid) usersRepo.setLid(user.jid, lid); // fill in a lid we hadn't captured yet

      if (!user) {
        console.log('[BOT] %s no tiene acceso, respondo con el mensaje genérico.', phoneJid);
        await this.wa.sendText(jid, PRIVATE_BOT_REPLY);
        return;
      }

      console.log('[BOT] Usuario resuelto: #%d "%s" (%s)', user.id, user.name ?? '(sin nombre)', user.role);

      const command = text.trim().toLowerCase();

      // Sticker pack (see agent/tools/send-sticker.tool.ts) - only the admin can teach the bot a
      // new one, by sending it as a real WhatsApp sticker. Checked before everything else below:
      // a sticker carries no meaningful text, and Fashion Mode/the mode router have nothing to do
      // with it either way.
      if (stickerMessage) {
        if (user.role === 'admin') {
          try {
            const data = (await downloadMediaMessage(stickerMessage, 'buffer', {})) as Buffer;
            const mimetype = stickerMessage.message?.stickerMessage?.mimetype ?? 'image/webp';
            const saved = stickersRepo.createPending(user.id, data, mimetype);
            console.log('[STICKER] Sticker #%d recibido del admin #%d, pendiente de etiqueta.', saved.id, user.id);
            await this.wa.sendText(
              jid,
              '🏷️ Sticker recibido. ¿Con qué etiqueta lo guardo? (ej. "buenos_dias", "celebracion", "motivacion")',
            );
          } catch (err) {
            console.error('[STICKER] Error descargando el sticker del admin:', (err as Error).message);
            await this.wa.sendText(jid, '⚠️ No pude descargar ese sticker, intenta de nuevo.').catch(() => {});
          }
        }
        return; // nothing else to do with this turn either way
      }

      // If the admin just sent a sticker and hasn't named it yet, their next plain-text message
      // (not a raw command like /menu) is that label. Checked early for the same reason as above.
      const pendingSticker = user.role === 'admin' ? stickersRepo.getPendingFor(user.id) : undefined;
      if (pendingSticker && text.trim() && !command.startsWith('/')) {
        const label = normalizeStickerLabel(text);
        stickersRepo.setLabel(pendingSticker.id, label);
        console.log('[STICKER] Sticker #%d etiquetado como "%s".', pendingSticker.id, label);
        await this.wa.sendText(jid, `✅ Guardado como "${label}" - lo uso cuando calce en la conversación, sin que me lo pidas.`);
        return;
      }

      // Shared WhatsApp contact card(s) (native "share contact" feature, see util/vcard.ts) - works
      // for anyone, not admin-only (sharing your own contacts is a normal action). Nothing is saved
      // yet: only offered, and only actually written to `contacts` once the person replies "sí"
      // (see the pending-batch reply handler right below).
      if (contactMessage) {
        const shared = extractSharedContacts(contactMessage);
        if (shared.length === 0) {
          await this.wa.sendText(jid, '⚠️ No pude leer ese contacto, ¿me lo compartes de nuevo?').catch(() => {});
          return;
        }
        pendingContactsRepo.replaceForUser(user.id, shared);
        console.log('[CONTACTS] Usuario #%d compartió %d contacto(s), pendiente de confirmación.', user.id, shared.length);
        const list = shared.map((c, i) => `${i + 1}. ${c.name} - ${c.phone}`).join('\n');
        await this.wa.sendText(
          jid,
          `📇 Recibí ${shared.length} contacto${shared.length > 1 ? 's' : ''}:\n\n${list}\n\n` +
            '¿Los guardo? Responde "sí" para guardar todos, los números separados por coma para guardar ' +
            'solo algunos (ej. "1,3"), o "no" para descartar.',
        );
        return;
      }

      // Answer to the "¿los guardo?" offer above - only "sí"/"no"/a list of numbers is consumed
      // here; anything else falls through untouched and the offer just stays pending (a new shared
      // batch, or an explicit answer later, is how it gets resolved).
      const pendingContacts = pendingContactsRepo.listForUser(user.id);
      if (pendingContacts.length > 0 && command) {
        if (/^(si|sí|guardar( todos)?)$/.test(command)) {
          for (const c of pendingContacts) contactsRepo.upsert(user.id, c.name, phoneToJid(c.phone), null);
          pendingContactsRepo.clearForUser(user.id);
          console.log('[CONTACTS] Usuario #%d guardó %d contacto(s) compartido(s).', user.id, pendingContacts.length);
          await this.wa.sendText(jid, `✅ Guardé ${pendingContacts.length} contacto(s). Ya puedes escribirles por nombre.`);
          return;
        }
        if (/^(no|cancelar|descartar)$/.test(command)) {
          pendingContactsRepo.clearForUser(user.id);
          console.log('[CONTACTS] Usuario #%d descartó %d contacto(s) compartido(s).', user.id, pendingContacts.length);
          await this.wa.sendText(jid, '👍 Descartado, no guardé nada.');
          return;
        }
        const indices = command
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= pendingContacts.length);
        if (indices.length > 0) {
          const chosen = indices.map((i) => pendingContacts[i - 1]);
          for (const c of chosen) contactsRepo.upsert(user.id, c.name, phoneToJid(c.phone), null);
          pendingContactsRepo.clearForUser(user.id);
          console.log('[CONTACTS] Usuario #%d guardó %d de %d contacto(s) compartido(s).', user.id, chosen.length, pendingContacts.length);
          await this.wa.sendText(jid, `✅ Guardé ${chosen.length} de los ${pendingContacts.length} contactos.`);
          return;
        }
      }

      if (command === '/reset') {
        messagesRepo.clear(user.id);
        await this.wa.sendText(jid, '🧹 Historial de conversación borrado.');
        return;
      }

      if (command === '/reset todo') {
        await this.wa.sendText(jid, RESET_ALL_WARNING);
        return;
      }

      if (command === '/reset todo confirmar') {
        resetAllUserData(user.id);
        console.log('[BOT] #%d pidio /reset todo confirmar - se borro toda su informacion.', user.id);
        await this.wa.sendText(jid, '🗑️ Listo, borré todo tu contenido. Seguimos desde cero.');
        return;
      }

      if (command === '/ayuda' || command === '/help') {
        await this.wa.sendText(jid, HELP_TEXT);
        return;
      }

      // Full feature menu (two levels: categories, then one detail screen per category) - zero
      // token, same raw-command pattern as /reset/ayuda above. See agent/menu.ts for the single
      // source of truth also used by the show_menu AI tool, so both entry points stay in sync.
      if (command === '/menu') {
        const access = { fashionEnabled: env.fashion.enabled, callsEnabled: isTwilioConfigured(), isAdmin: user.role === 'admin' };
        await this.wa.sendText(jid, renderMainMenu(access));
        return;
      }
      if (command.startsWith('/menu ')) {
        const access = { fashionEnabled: env.fashion.enabled, callsEnabled: isTwilioConfigured(), isAdmin: user.role === 'admin' };
        const category = resolveMenuCategory(command.slice('/menu '.length), access);
        await this.wa.sendText(jid, category ? renderCategoryDetail(category) : renderUnknownCategory(access));
        return;
      }

      // Fashion Mode (armario/outfits, see src/fashion/) - entirely gated behind this flag, and
      // the `&&` short-circuits before ever touching fashion_sessions, so a disabled deploy has
      // zero behavior change here. Runs BEFORE the AI loop (pure state-machine, no tokens spent)
      // for exactly the same reason the /reset-style commands above do - a structured wizard step
      // (a numbered menu choice, a photo) doesn't need a model in the loop.
      if (env.fashion.enabled) {
        const result = await handleFashionMessage({ userId: user.id, jid, text, imageMessage, documentMessage, wa: this.wa });
        if (result.consumed) {
          if (result.reply) await this.wa.sendText(jid, result.reply);
          return;
        }
      }
      // Special modes (rutinas/tareas/notas/contactos/comidas/premios/resúmenes) - see agent/modes.ts.
      // Also zero-token, same raw-command pattern as everything above. Runs after Fashion Mode
      // (a fully separate island) so its own "salir"/entry keywords never collide with these.
      const modeResult = handleModeMessage(user.id, text);
      if (modeResult.consumed) {
        if (modeResult.reply) await this.wa.sendText(jid, modeResult.reply);
        return;
      }

      if (!text.trim()) return; // bare image, not consumed by Fashion - same silent-ignore as before this feature existed

      // Brief human-like pauses (see util/human-delay.ts) so replies don't land instantly on
      // every message - an obviously scripted response pattern is one of the signals that
      // increases spam/ban risk, on top of just feeling robotic.
      await sleep(readingPauseMs());
      await this.wa.sendTyping(jid);

      // processMessage() already catches AI-provider failures internally and returns a friendly
      // message instead of throwing (see ai-agent.ts's callModelWithRetry) - the outer try/catch
      // here is the last-resort net for anything else unexpected.
      const reply = await withWorkingUpdates(
        processMessage(text, this.wa, {
          id: user.id,
          jid: user.jid,
          isAdmin: user.role === 'admin',
        }),
        async () => {
          await this.wa.sendTyping(jid).catch(() => {});
          await this.wa.sendText(jid, workingUpdateMessage()).catch(() => {});
        },
        { intervalMs: WORKING_UPDATE_INTERVAL_MS, maxTicks: WORKING_UPDATE_MAX_TICKS },
      );
      console.log('[BOT] Respuesta final a #%d: "%s"', user.id, reply.length > 200 ? `${reply.slice(0, 200)}…` : reply);
      await sleep(typingDelayMs(reply));
      await this.wa.sendText(jid, reply);

      if (fromAudio) {
        // Also try a voice reply (local TTS, no AI/tokens - see audio/tts.ts). Best-effort - if
        // Piper isn't configured, the text reply above stands alone and nothing else happens.
        const voice = await synthesizeVoiceNote(reply).catch(() => null);
        if (voice) {
          await this.wa.sendAudio(jid, voice).catch((err) => {
            console.error('[BOT] Error enviando nota de voz:', (err as Error).message);
          });
        }
      }
    } catch (err) {
      console.error('[BOT] Error inesperado manejando mensaje de %s:', jid, (err as Error).message);
      await this.wa.sendText(jid, ERROR_REPLY).catch((sendErr) => {
        console.error('[BOT] Ademas no se pudo avisar del error:', (sendErr as Error).message);
      });
    }
  }
}
