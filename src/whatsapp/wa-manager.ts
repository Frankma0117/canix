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

  qr: string | undefined;
  connectionState: ConnectionState['connection'] = 'close';

  constructor(private session: string) {
    this.authDir = join(process.cwd(), 'auth_info', session);
  }

  /** Registers the callback that processes incoming messages. */
  onMessage(handler: IncomingHandler): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    this.stopping = false;
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: baileysLogger,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
    });
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
        this.qr = undefined;
        this.reconnectAttempt = 0;
        console.log('[WA] Conectado a WhatsApp.');
      }

      if (connection === 'close') {
        if (this.stopping) return; // intentional disconnect/logout, don't auto-retry

        const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        console.log('[WA] Conexion cerrada (code=%s).', code ?? '?');
        if (loggedOut) {
          console.log('[WA] Sesion cerrada. Borrando credenciales para poder generar un QR nuevo.');
          void rm(this.authDir, { recursive: true, force: true });
        } else if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
          console.log('[WA] Demasiados intentos fallidos, dejo de reintentar. Conecta de nuevo desde el panel.');
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
    await rm(this.authDir, { recursive: true, force: true });
  }
}
