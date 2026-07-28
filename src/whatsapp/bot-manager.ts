import { jidNormalizedUser } from 'baileys';
import { WaManager } from './wa-manager.js';
import { usersRepo } from '../db/repositories/users.repo.js';
import { messagesRepo } from '../db/repositories/messages.repo.js';
import { resetAllUserData } from '../db/reset-user.js';
import { processMessage } from '../agent/ai-agent.js';
import { env } from '../config/env.js';
import { sleep, typingDelayMs, readingPauseMs } from '../util/human-delay.js';
import { synthesizeVoiceNote } from '../audio/tts.js';

const PRIVATE_BOT_REPLY =
  'Este es un asistente personal privado y no tienes acceso todavía. Pídele al administrador que te lo dé. 🙏';

const ERROR_REPLY =
  '⚠️ Tuve un problema técnico procesando tu mensaje. Ya quedó registrado, intenta de nuevo en un ' +
  'momento - si te sigue pasando seguido, avísale al administrador.';

const RESET_ALL_WARNING =
  '⚠️ Esto borra TODO tu contenido: recordatorios, rutinas, contactos, links, categorías, ' +
  'premios/castigos e historial de chat - no se puede deshacer (tu acceso al bot no se toca). ' +
  'Si estás seguro, escribe exactamente:\n\n/reset todo confirmar';

const HELP_TEXT =
  'Comandos disponibles:\n\n' +
  '/reset - borra el historial de esta conversación (empezamos a "hablar" de cero, tu ' +
  'información sigue intacta).\n' +
  '/reset todo - borra TODA tu información (recordatorios, rutinas, contactos, links, ' +
  'categorías, premios/castigos e historial) y empieza de cero. Pide confirmación antes de ' +
  'hacerlo, no se puede deshacer.\n' +
  '/ayuda - muestra este mensaje.\n\n' +
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
  }: {
    jid: string;
    name?: string;
    text: string;
    fromAudio?: boolean;
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
        console.log(
          '[SETUP] Administrador registrado: "%s" (jid=%s%s) #%d',
          name ?? '(sin nombre)',
          phoneJid,
          lid ? `, lid=${lid}` : '',
          admin.id,
        );
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

      // Brief human-like pauses (see util/human-delay.ts) so replies don't land instantly on
      // every message - an obviously scripted response pattern is one of the signals that
      // increases spam/ban risk, on top of just feeling robotic.
      await sleep(readingPauseMs());
      await this.wa.sendTyping(jid);

      // processMessage() already catches AI-provider failures internally and returns a friendly
      // message instead of throwing (see ai-agent.ts's callModelWithRetry) - the outer try/catch
      // here is the last-resort net for anything else unexpected.
      const reply = await processMessage(text, this.wa, {
        id: user.id,
        jid: user.jid,
        isAdmin: user.role === 'admin',
      });
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
