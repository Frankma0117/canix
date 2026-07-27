import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  type WASocket,
  type ConnectionState,
} from 'baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import { baileysLogger } from './logger.js';

/** After this many consecutive failed reconnects, stop retrying automatically (see start()). */
const MAX_RECONNECT_ATTEMPTS = 6;

export type IncomingHandler = (msg: {
  jid: string;
  name?: string;
  text: string;
}) => Promise<void>;

/**
 * Manages the single WhatsApp session (this is a personal, single-user bot -
 * one dedicated WhatsApp number, unlike a multi-tenant setup): connection,
 * QR, automatic reconnection and sending messages.
 */
export class WaManager {
  private sock: WASocket | undefined;
  private handler: IncomingHandler | undefined;
  private authDir: string;
  private stopping = false;
  private reconnectAttempt = 0;
  /** Guards against two overlapping start() calls opening two sockets on the same session at once. */
  private connecting = false;

  qr: string | undefined;
  connectionState: ConnectionState['connection'] = 'close';
  /**
   * Set when WhatsApp itself rejects the connection (HTTP 403 / DisconnectReason.forbidden).
   * This is the same signal that precedes number bans/restrictions, so we stop auto-retrying
   * and require an explicit manual reconnect instead of hammering the endpoint.
   */
  banSuspected = false;
  lastDisconnectCode: number | undefined;

  constructor(private session: string) {
    this.authDir = join(process.cwd(), 'auth_info', session);
  }

  /** Registers the callback that processes incoming messages. */
  onMessage(handler: IncomingHandler): void {
    this.handler = handler;
  }

  private async buildSocket() {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
      version,
      auth: state,
      logger: baileysLogger,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
    });
    return { sock, saveCreds };
  }

  async start(): Promise<void> {
    if (this.connecting || this.isConnected()) return; // never open a second socket on top of a live/pending one
    this.connecting = true;
    this.stopping = false;

    const built = await this.buildSocket().catch((err) => {
      this.connecting = false;
      throw err;
    });
    const { sock, saveCreds } = built;
    this.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        this.qr = qr;
        console.log('[WA] Escanea este QR con WhatsApp (Dispositivos vinculados):');
        qrcode.generate(qr, { small: true });
      }
      if (connection) this.connectionState = connection;

      if (connection === 'open') {
        this.connecting = false;
        this.qr = undefined;
        this.reconnectAttempt = 0;
        this.banSuspected = false;
        console.log('[WA] Conectado a WhatsApp.');
      }

      if (connection === 'close') {
        this.connecting = false;
        if (this.stopping) return; // intentional disconnect/logout, don't auto-retry

        const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        this.lastDisconnectCode = code;
        const loggedOut = code === DisconnectReason.loggedOut;
        const forbidden = code === DisconnectReason.forbidden; // 403
        console.log('[WA] Conexion cerrada (code=%s).', code ?? '?');

        if (loggedOut) {
          console.log('[WA] Sesion cerrada. Borrando credenciales para poder generar un QR nuevo.');
          void rm(this.authDir, { recursive: true, force: true });
          return;
        }

        if (forbidden) {
          // A 403 means WhatsApp's servers rejected the connection outright - this is the same
          // signal that shows up right before/during a number ban or temporary restriction.
          // Auto-retrying in a loop here is exactly the "suspicious automated behaviour" pattern
          // that gets numbers flagged, so we stop and wait for a deliberate manual reconnect
          // (see /api/connection/reconnect) instead. Credentials are kept intact - this is not
          // a logout, so there is no new QR to generate.
          this.banSuspected = true;
          console.log(
            '[WA] WhatsApp respondio 403 (prohibido). Puede ser un bloqueo temporal o definitivo del numero. ' +
              'NO se reintenta automaticamente: revisa el estado del numero en la app oficial de WhatsApp antes ' +
              'de reconectar manualmente desde el panel.',
          );
          return;
        }

        if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
          console.log('[WA] Demasiados intentos fallidos, dejo de reintentar. Reconecta desde el panel.');
        } else {
          const delay = Math.min(60_000, 2_000 * 2 ** this.reconnectAttempt);
          this.reconnectAttempt += 1;
          console.log('[WA] Reintentando conexion en %ds...', delay / 1000);
          setTimeout(() => void this.start(), delay);
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const m of messages) {
        const jid = m.key.remoteJid;
        if (!jid || jid === 'status@broadcast' || jid.endsWith('@g.us')) continue; // ignore groups/status
        if (m.key.fromMe) continue; // this bot uses a dedicated number, not a self-chat

        const text =
          m.message?.conversation ??
          m.message?.extendedTextMessage?.text ??
          m.message?.imageMessage?.caption ??
          '';
        if (!text.trim()) continue;

        const name = m.pushName || undefined;

        try {
          await this.handler?.({ jid, name, text: text.trim() });
        } catch (err) {
          console.error('[WA] Error procesando mensaje:', (err as Error).message);
        }
      }
    });
  }

  /** Sends a text message to a JID (e.g. 573001234567@s.whatsapp.net). */
  async sendText(jid: string, text: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp no esta conectado');
    await this.sock.sendMessage(jid, { text });
  }

  /** Briefly shows "typing..." (feedback to the user). */
  async sendTyping(jid: string): Promise<void> {
    try {
      await this.sock?.sendPresenceUpdate('composing', jid);
    } catch {
      /* no critico */
    }
  }

  isConnected(): boolean {
    return this.connectionState === 'open';
  }

  /**
   * Manually re-establishes the connection without restarting the whole process, e.g. from the
   * admin panel's "Reconectar" button. Only does something when the socket is actually idle -
   * calling it while already connected/connecting is a no-op, and the reconnect() itself needs
   * to be explicit rather than automatic once a 403 has been seen (see connection.update above).
   */
  async reconnect(): Promise<void> {
    if (this.connecting || this.isConnected()) return;
    this.reconnectAttempt = 0;
    this.banSuspected = false;
    await this.start();
  }

  /** Logs the session out and deletes its stored credentials, so the next start() shows a fresh QR. */
  async logout(): Promise<void> {
    this.stopping = true;
    try {
      await this.sock?.logout();
    } catch {
      /* the socket may already be closed */
    }
    this.sock = undefined;
    this.qr = undefined;
    this.connectionState = 'close';
    this.reconnectAttempt = 0;
    this.banSuspected = false;
    await rm(this.authDir, { recursive: true, force: true });
  }

  /**
   * Abandons the current number and starts fresh: discards stored credentials and immediately
   * shows a new QR, so a *different* phone number can be linked instead. This is the deliberate,
   * manual escape hatch for when the linked number is flagged/blocked (banSuspected) and waiting
   * on it (via reconnect()) isn't an option - it is never triggered automatically, only by an
   * explicit admin action, since repeatedly discarding/relinking on its own would itself look
   * like the kind of churn that gets numbers flagged.
   */
  async useNewNumber(): Promise<void> {
    await this.logout();
    await this.start();
  }
}
