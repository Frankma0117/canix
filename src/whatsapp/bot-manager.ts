import { WaManager } from './wa-manager.js';
import { usersRepo } from '../db/repositories/users.repo.js';
import { messagesRepo } from '../db/repositories/messages.repo.js';
import { processMessage } from '../agent/ai-agent.js';
import { env } from '../config/env.js';
import { sleep, typingDelayMs, readingPauseMs } from '../util/human-delay.js';
import { synthesizeVoiceNote } from '../audio/tts.js';

const PRIVATE_BOT_REPLY =
  'Este es un asistente personal privado y no tienes acceso todavía. Pídele al administrador que te lo dé. 🙏';

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
    if (!usersRepo.hasAny()) {
      const admin = usersRepo.create({ jid, name: name ?? null, role: 'admin' });
      console.log('[SETUP] %s registrado como administrador (primer contacto). #%d', jid, admin.id);
    }

    // WhatsApp sometimes routes a known user's messages through their @lid instead of their
    // phone jid (privacy-related routing) - if the direct lookup misses, try resolving it via
    // Baileys' own PN<->LID mapping store before concluding they're actually unauthorized.
    let user = usersRepo.getByJidOrLid(jid);
    if (!user && jid.endsWith('@lid')) {
      const resolvedPn = await this.wa.resolveLidToPhoneJid(jid);
      if (resolvedPn) user = usersRepo.getByJidOrLid(resolvedPn);
    }

    if (!user) {
      await this.wa.sendText(jid, PRIVATE_BOT_REPLY);
      return;
    }

    if (text.trim() === '/reset') {
      messagesRepo.clear(user.id);
      await this.wa.sendText(jid, '🧹 Historial de conversación borrado.');
      return;
    }

    // Brief human-like pauses (see util/human-delay.ts) so replies don't land instantly on
    // every message - an obviously scripted response pattern is one of the signals that
    // increases spam/ban risk, on top of just feeling robotic.
    await sleep(readingPauseMs());
    await this.wa.sendTyping(jid);
    const reply = await processMessage(text, this.wa, {
      id: user.id,
      jid: user.jid,
      isAdmin: user.role === 'admin',
    });
    await sleep(typingDelayMs(reply));
    await this.wa.sendText(jid, reply);

    if (fromAudio) {
      // Replied to a voice note: also try a voice reply (local TTS, no AI/tokens - see
      // audio/tts.ts). Best-effort - if Piper isn't configured, the text reply above stands
      // alone and nothing else happens.
      const voice = await synthesizeVoiceNote(reply).catch(() => null);
      if (voice) {
        await this.wa.sendAudio(jid, voice).catch((err) => {
          console.error('[BOT] Error enviando nota de voz:', (err as Error).message);
        });
      }
    }
  }
}
