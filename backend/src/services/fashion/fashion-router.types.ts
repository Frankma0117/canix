import type { WAMessage } from 'baileys';
import type { WaManager } from '../../channels/whatsapp/wa-manager.js';

/** Shared between fashion.router.ts and every flows/*.ts file - kept in its own module so flows can
 *  import the types without a circular import with the router that dispatches to them. */
export interface FashionRouterContext {
  userId: number;
  jid: string;
  text: string;
  imageMessage?: WAMessage;
  documentMessage?: WAMessage;
  wa: WaManager;
}

export interface FashionRouterResult {
  consumed: boolean;
  reply?: string;
  /** With consumed=false: the text the rest of the bot should answer instead of the one just sent
   *  (an earlier message Fashion held while it asked whether it was about the outfit). */
  forward?: string;
  /** A richer answer (garment photos + a summary) that sends itself; resolves to the text kept in
   *  the conversation history. Used instead of `reply`. */
  deliver?: () => Promise<string>;
}
