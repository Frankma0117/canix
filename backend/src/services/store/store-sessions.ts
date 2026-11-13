import { WaManager, type IncomingHandler, type OwnMessageHandler, type ReactionHandler } from '../../channels/whatsapp/wa-manager.js';
import { storesModel } from '../../models/store.model.js';
import { AUTH_DIR } from '../../config/paths.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Multi-session: every business of the order-taking assistant has its OWN WhatsApp number, linked
 * as its own session next to Canix's (same process, separate socket and credentials folder
 * auth_info/store-<id>). This registry owns those sessions; what to do with their traffic is
 * registered by the engine (see store-engine.ts), so this file knows nothing about orders.
 */
export interface StoreSessionHandlers {
  onMessage: (storeId: number, msg: Parameters<IncomingHandler>[0]) => Promise<void>;
  onReaction: (storeId: number, reaction: Parameters<ReactionHandler>[0]) => Promise<void>;
  onOwnMessage: (storeId: number, msg: Parameters<OwnMessageHandler>[0]) => Promise<void>;
}

const sessions = new Map<number, WaManager>();
let handlers: StoreSessionHandlers | undefined;
/** Canix's own session: the fallback for notices to the business' people. */
let mainSession: WaManager | undefined;

export const storeSessionName = (storeId: number) => `store-${storeId}`;

export function setStoreSessionHandlers(h: StoreSessionHandlers): void {
  handlers = h;
}

export function setMainSession(wa: WaManager): void {
  mainSession = wa;
}

export function getMainSession(): WaManager | undefined {
  return mainSession;
}

/** The session of a store, created (not connected) on first use. */
export function storeSession(storeId: number): WaManager {
  let wa = sessions.get(storeId);
  if (!wa) {
    wa = new WaManager(storeSessionName(storeId), { business: true });
    wa.onMessage((msg) => handlers?.onMessage(storeId, msg) ?? Promise.resolve());
    wa.onReaction((reaction) => handlers?.onReaction(storeId, reaction) ?? Promise.resolve());
    wa.onOwnMessage((msg) => handlers?.onOwnMessage(storeId, msg) ?? Promise.resolve());
    sessions.set(storeId, wa);
  }
  return wa;
}

/** True when this store's number was linked at some point (its credentials are on disk). */
function hasCredentials(storeId: number): boolean {
  return existsSync(join(AUTH_DIR, storeSessionName(storeId), 'creds.json'));
}

/**
 * At boot: reconnects every active store whose number is already linked. A store that was never
 * linked is left alone - its QR is only requested when someone opens "Conectar" in the portal,
 * so an unused store never keeps a socket open asking WhatsApp for QR codes.
 */
export async function startStoreSessions(): Promise<void> {
  for (const store of storesModel.list()) {
    if (!store.active || !hasCredentials(store.id)) continue;
    console.log('[STORE] Connecting the WhatsApp session of "%s" (#%d)...', store.name, store.id);
    void storeSession(store.id)
      .start()
      .catch((err) => console.error('[STORE] Could not start the session of store #%d:', store.id, (err as Error).message));
  }
}

export interface StoreConnectionStatus {
  connection: string;
  connected: boolean;
  hasQr: boolean;
  banSuspected: boolean;
  linked: boolean;
  phone: string | null;
}

export function storeConnectionStatus(storeId: number): StoreConnectionStatus {
  const wa = sessions.get(storeId);
  return {
    connection: wa?.connectionState ?? 'close',
    connected: wa?.isConnected() ?? false,
    hasQr: Boolean(wa?.qr),
    banSuspected: wa?.banSuspected ?? false,
    linked: hasCredentials(storeId),
    phone: wa?.ownPhone() ?? null,
  };
}

/** Logs the store's number out and forgets its session (the store is being deleted or unlinked). */
export async function dropStoreSession(storeId: number): Promise<void> {
  const wa = sessions.get(storeId) ?? (hasCredentials(storeId) ? storeSession(storeId) : undefined);
  if (!wa) return;
  await wa.logout().catch((err) => console.error('[STORE] Could not log out the session of store #%d:', storeId, (err as Error).message));
  sessions.delete(storeId);
}
