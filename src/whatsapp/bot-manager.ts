import { WaManager } from './wa-manager.js';
import { ownerRepo } from '../db/repositories/owner.repo.js';
import { messagesRepo } from '../db/repositories/messages.repo.js';
import { processMessage } from '../agent/ai-agent.js';
import { env } from '../config/env.js';

const PRIVATE_BOT_REPLY =
  'Este es un asistente personal privado y no puedo ayudarte. 🙏';

/**
 * Owns the single WhatsApp session and wires incoming messages to the agent.
 * The first person to ever message this bot becomes its owner (auto-assigned,
 * same idea as estylia's manager auto-promotion) - since this is a personal
 * assistant, everyone else who writes to it gets a generic private reply
 * instead of being able to use it.
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

  private async handleIncoming({ jid, name, text }: { jid: string; name?: string; text: string }) {
    if (!ownerRepo.get()) {
      ownerRepo.setIfMissing(jid, name ?? null);
      console.log('[SETUP] %s registrado como dueño del asistente (primer contacto).', jid);
    }

    if (!ownerRepo.isOwner(jid)) {
      await this.wa.sendText(jid, PRIVATE_BOT_REPLY);
      return;
    }

    if (text.trim() === '/reset') {
      messagesRepo.clear();
      await this.wa.sendText(jid, '🧹 Historial de conversación borrado.');
      return;
    }

    await this.wa.sendTyping(jid);
    const reply = await processMessage(text, this.wa, jid);
    await this.wa.sendText(jid, reply);
  }
}
