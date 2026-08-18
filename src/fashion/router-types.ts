import type { WAMessage } from 'baileys';
import type { WaManager } from '../whatsapp/wa-manager.js';

/** Shared between router.ts and every flows/*.ts file - kept in its own module (not router.ts) so
 *  flows can import the types without creating a circular import with the router that dispatches
 *  to them. */
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
}
