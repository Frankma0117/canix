import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  DisconnectReason,
  type WASocket,
  type ConnectionState,
  type WAMessage,
} from 'baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import { baileysLogger } from './logger.js';
import { toPcm16Mono16k } from '../audio/ffmpeg.js';
import { transcribePcm } from '../audio/stt.js';
import { usersRepo } from '../db/repositories/users.repo.js';
import { contactsRepo } from '../db/repositories/contacts.repo.js';

/** After this many consecutive failed reconnects, stop retrying automatically (see start()). */
const MAX_RECONNECT_ATTEMPTS = 6;

export type IncomingHandler = (msg: {
  jid: string;
  name?: string;
  text: string;
  /** True when `text` came from transcribing a voice note rather than being typed. */
  fromAudio?: boolean;
  /** The full WAMessage, present only when it carries an image - deliberately lazy: nothing here
   *  downloads the image bytes, only a caller that actually needs them (Fashion Mode mid-flow, see
   *  fashion/image/image-intake.ts) calls downloadMediaMessage() on it. Every other path ignores
   *  it exactly like before this field existed (only imageMessage.caption, via `text`, is used). */
  imageMessage?: WAMessage;
  /** Same laziness as imageMessage, for a document attachment (Fashion Mode's "send a PDF full of
   *  garment photos" bulk import, see fashion/image/pdf-intake.ts) - only downloaded if Fashion
   *  Mode actually consumes it as a PDF. */
  documentMessage?: WAMessage;
  /** Same laziness, for an incoming sticker - only downloaded when the sender is the admin
   *  teaching the bot a new one (see the sticker pack flow in bot-manager.ts). */
  stickerMessage?: WAMessage;
  /** Present for a WhatsApp "share contact" message (one or several at once) - no media download
   *  involved here, the vCard(s) are already inline on the message (see util/vcard.ts). */
  contactMessage?: WAMessage;
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

  // WhatsApp itself can hand the same message to messages.upsert more than once (a reconnect
  // replaying its offline queue, a retry receipt, etc.) - with nothing tracking which message ids
  // were already handled, each redelivery ran the full agent loop again, which could genuinely
  // create a second reminder/message for one request (this is a real, separate cause of "duplicate
  // reminder" reports from the write-before-send race already fixed in task-scheduler.ts). Capped
  // at the last 500 ids (per jid+id, since ids aren't globally unique) so it can't grow unbounded.
  private seenMessageIds = new Set<string>();

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

  /**
   * fetchLatestBaileysVersion() hits a GitHub URL with no timeout of its own - on a flaky/blocked
   * network it can hang far longer than anyone will wait for a QR, silently stalling start()
   * (and therefore reconnect()/useNewNumber()). Race it against a timeout and fall back to
   * Baileys' own bundled default version (used automatically when `version` is omitted).
   */
  private async resolveVersion(): Promise<[number, number, number] | undefined> {
    try {
      const { version } = await Promise.race([
        fetchLatestBaileysVersion(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000)),
      ]);
      return version as [number, number, number];
    } catch {
      console.log('[WA] No se pudo obtener la ultima version de Baileys a tiempo; uso la version incluida por defecto.');
      return undefined;
    }
  }

  private async buildSocket() {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const version = await this.resolveVersion();
    const sock = makeWASocket({
      ...(version ? { version } : {}),
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

    // WhatsApp's privacy-preserving id (@lid) for a contact/user is learned from traffic, not
    // looked up on demand - persist every pairing as we learn it so sends/identity checks can
    // use it later (see contactsRepo.sendTarget / bot-manager's user lookup).
    sock.ev.on('lid-mapping.update', ({ pn, lid }) => {
      usersRepo.setLid(pn, lid);
      contactsRepo.setLidForPhoneJid(pn, lid);
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const m of messages) {
        const jid = m.key.remoteJid;
        if (!jid || jid === 'status@broadcast' || jid.endsWith('@g.us')) continue; // ignore groups/status
        if (m.key.fromMe) continue; // this bot uses a dedicated number, not a self-chat

        if (m.key.id) {
          const dedupeKey = `${jid}:${m.key.id}`;
          if (this.seenMessageIds.has(dedupeKey)) {
            console.log('[WA] Mensaje %s duplicado (ya procesado), lo ignoro.', dedupeKey);
            continue;
          }
          this.seenMessageIds.add(dedupeKey);
          if (this.seenMessageIds.size > 500) {
            const oldest = this.seenMessageIds.values().next().value;
            if (oldest !== undefined) this.seenMessageIds.delete(oldest);
          }
        }

        let text =
          m.message?.conversation ??
          m.message?.extendedTextMessage?.text ??
          m.message?.imageMessage?.caption ??
          '';
        let fromAudio = false;
        // Present only when this message carries an image - see IncomingHandler's comment. Passed
        // through as-is (never downloaded here); a bare image with no caption used to be silently
        // dropped by the `continue` below - now it reaches the handler, which restores that same
        // silent-drop behavior itself whenever Fashion Mode doesn't consume it (flag off, or the
        // user isn't actually waiting on one) - see bot-manager.ts.
        const imageMessage = m.message?.imageMessage ? m : undefined;
        // Same idea for documents (Fashion Mode's PDF bulk-import) - passed through untouched for
        // anything that isn't a fashion PDF, exactly like a document was ignored before this field
        // existed.
        const documentMessage = m.message?.documentMessage ? m : undefined;
        // Same idea for stickers (the bot's sticker pack, see bot-manager.ts) - passed through
        // untouched; only an admin's incoming sticker is ever actually downloaded.
        const stickerMessage = m.message?.stickerMessage ? m : undefined;
        // A shared contact (or several at once) - see util/vcard.ts / bot-manager.ts's save-with-
        // confirmation flow. No media download involved, the vCard(s) are already inline.
        const contactMessage = m.message?.contactMessage || m.message?.contactsArrayMessage ? m : undefined;

        if (!text.trim() && m.message?.audioMessage) {
          const transcribed = await this.transcribeIncomingAudio(m);
          if (transcribed) {
            text = transcribed;
            fromAudio = true;
          } else {
            await this.sendText(jid, 'No pude entender el audio 🙈 ¿me lo escribes o lo repites?').catch(() => {});
            continue;
          }
        }

        if (!text.trim() && !imageMessage && !documentMessage && !stickerMessage && !contactMessage) continue;

        const name = m.pushName || undefined;

        // Mark it read (blue ticks) right as we start actually handling it - mirrors a person
        // opening the chat and reading the message before typing a reply. Best-effort: a failed
        // read receipt shouldn't stop the message from being answered.
        await sock.readMessages([m.key]).catch((err) => {
          console.error('[WA] No se pudo marcar como leido:', (err as Error).message);
        });

        try {
          await this.handler?.({ jid, name, text: text.trim(), fromAudio, imageMessage, documentMessage, stickerMessage, contactMessage });
        } catch (err) {
          console.error('[WA] Error procesando mensaje:', (err as Error).message);
        }
      }
    });
  }

  /** Downloads a voice note and transcribes it locally (Vosk). Returns null if unavailable/failed. */
  private async transcribeIncomingAudio(m: WAMessage): Promise<string | null> {
    try {
      const buffer = await downloadMediaMessage(m, 'buffer', {});
      const pcm = await toPcm16Mono16k(buffer);
      return transcribePcm(pcm);
    } catch (err) {
      console.error('[WA] Error transcribiendo audio:', (err as Error).message);
      return null;
    }
  }

  /**
   * Actively looks up and persists a phone jid's @lid (if WhatsApp has one for it), instead of
   * only waiting to learn it passively from that person's incoming traffic. Used to enrich
   * contacts/users records for identification purposes (see add-contact.tool.ts,
   * grant-access.tool.ts, bot-manager's incoming-sender resolution).
   *
   * Deliberately NOT used to pick the *send* target anymore (see sendText/sendAudio below) - an
   * earlier version of this code forced every send through a lid resolved this way, on the theory
   * that phone-jid sends could fail for lid-primary accounts. In practice that made things worse:
   * real traffic showed messages only actually arrived for people who'd already written to the
   * bot (whose lid we'd learned from a real, live conversation - see the 'lid-mapping.update'
   * listener), while a *speculatively queried* lid for someone who'd never messaged first would
   * get accepted by sendMessage() with no error, yet silently never arrive. Baileys already knows
   * how to route a plain phone-jid send correctly on its own; forcing our own guessed lid in front
   * of it was actively harmful for exactly the "message someone cold" case that matters most here.
   */
  async prefetchLid(jid: string): Promise<string | null> {
    if (!this.sock || !jid.endsWith('@s.whatsapp.net')) return null;
    try {
      const lid = await this.sock.signalRepository.lidMapping.getLIDForPN(jid);
      if (lid) {
        usersRepo.setLid(jid, lid);
        contactsRepo.setLidForPhoneJid(jid, lid);
        return lid;
      }
    } catch (err) {
      console.error('[WA] No se pudo resolver el lid de %s:', jid, (err as Error).message);
    }
    return null;
  }

  /**
   * Checks whether a phone jid is an actual, reachable WhatsApp account - useful right when
   * saving a contact/granting access, to catch a bad number (missing indicativo, typo, etc.)
   * immediately instead of only failing later when someone finally tries to message it.
   * Returns null (unknown, never blocks on it) if unconnected or the check itself fails.
   */
  async checkOnWhatsApp(jid: string): Promise<boolean | null> {
    if (!this.sock) return null;
    try {
      const results = await this.sock.onWhatsApp(jid);
      return results?.[0]?.exists ?? null;
    } catch (err) {
      console.error('[WA] No se pudo verificar %s en WhatsApp:', jid, (err as Error).message);
      return null;
    }
  }

  /**
   * Same lookup as checkOnWhatsApp(), but also returns the normalized jid WhatsApp itself resolved
   * for that number - preferible a construirlo a mano (ver phoneToJid en util/jid.ts) cuando se
   * trata de un número crudo recién escrito, porque a veces WhatsApp enruta una cuenta por un @lid
   * en vez del jid de teléfono plano, y solo esta consulta sabe cuál es el correcto. Null si el
   * socket no está conectado, la consulta falla, o el número no existe en WhatsApp.
   */
  async resolveOnWhatsApp(numberOrJid: string): Promise<{ jid: string; exists: boolean } | null> {
    if (!this.sock) return null;
    try {
      const results = await this.sock.onWhatsApp(numberOrJid);
      const match = results?.[0];
      return match ?? null;
    } catch (err) {
      console.error('[WA] No se pudo resolver %s en WhatsApp:', numberOrJid, (err as Error).message);
      return null;
    }
  }

  /**
   * WhatsApp requires a "trusted_contact" privacy token to exist between you and a jid for
   * messages to reliably reach them - Baileys normally issues this itself, but only as a
   * fire-and-forget call made AFTER the message is already sent (see messages-send.js), which
   * races the very first message to someone new against the token actually landing server-side.
   * Awaiting it here first closes that race for a first-contact send; it's a no-op-ish cheap call
   * for someone already trusted (an existing conversation), so it's safe to do on every send.
   */
  private async ensurePrivacyToken(jid: string): Promise<void> {
    if (!this.sock || jid.endsWith('@g.us') || jid === 'status@broadcast') return;
    try {
      await this.sock.issuePrivacyTokens([jid]);
    } catch (err) {
      // Best-effort - if this fails we still attempt the actual send below rather than blocking it.
      console.error('[WA] No se pudo emitir el token de privacidad para %s:', jid, (err as Error).message);
    }
    try {
      // Subscribing to presence is the other half of "cold" first-contact sends actually landing
      // reliably: on its own issuePrivacyTokens() sometimes isn't enough to make a brand new jid
      // (one that has never messaged this number before) resolve a session in time for the very
      // first sendMessage() right after - real traffic showed a subscribe here noticeably reduces
      // that "sent without error but never arrived" failure mode. Also best-effort/non-blocking.
      await this.sock.presenceSubscribe(jid);
    } catch (err) {
      console.error('[WA] No se pudo suscribir a la presencia de %s:', jid, (err as Error).message);
    }
  }

  /** Sends a text message to a JID (e.g. 573001234567@s.whatsapp.net) - sent exactly as given,
   *  no lid substitution (see prefetchLid's comment for why). */
  async sendText(jid: string, text: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp no esta conectado');
    await this.ensurePrivacyToken(jid);
    console.log('[WA] Enviando texto a %s', jid);
    await this.sock.sendMessage(jid, { text });
  }

  /** Sends a WhatsApp voice note (ogg/opus, played inline like a recorded ptt message). */
  async sendAudio(jid: string, audio: Buffer): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp no esta conectado');
    await this.ensurePrivacyToken(jid);
    console.log('[WA] Enviando audio a %s', jid);
    await this.sock.sendMessage(jid, { audio, mimetype: 'audio/ogg; codecs=opus', ptt: true });
  }

  /** Sends a WhatsApp sticker (static webp). Best-effort - a sticker send failing should never
   *  block the actual text reply/confirmation that already went out alongside it. */
  async sendSticker(jid: string, webp: Buffer): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp no esta conectado');
    await this.ensurePrivacyToken(jid);
    console.log('[WA] Enviando sticker a %s', jid);
    await this.sock.sendMessage(jid, { sticker: webp });
  }

  /** Sends an image by its public URL (Baileys/WhatsApp fetches it directly - no need to
   *  download+reupload) with an optional caption. Used by Fashion Mode to show a recommended
   *  outfit's actual garment photos (see fashion/flows/outfit.flow.ts). Best-effort at the call
   *  site - never let an image failing to send block the text summary that goes with it. */
  async sendImage(jid: string, url: string, caption?: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp no esta conectado');
    await this.ensurePrivacyToken(jid);
    console.log('[WA] Enviando imagen a %s', jid);
    await this.sock.sendMessage(jid, { image: { url }, caption });
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
   * Resolves a "@lid" jid to its underlying phone-number jid via Baileys' own PN<->LID mapping
   * store, for the (rare) case a known user's very first message arrives via lid before the
   * 'lid-mapping.update' event has had a chance to persist the pairing (see bot-manager.ts).
   * Returns null if unconnected or the mapping isn't known yet.
   */
  async resolveLidToPhoneJid(lid: string): Promise<string | null> {
    if (!this.sock) return null;
    try {
      return await this.sock.signalRepository.lidMapping.getPNForLID(lid);
    } catch {
      return null;
    }
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
    if (this.isConnected()) {
      // Only worth telling WhatsApp's servers about the logout when the socket is actually live -
      // sending it over a connection they already closed (e.g. after a 403) just waits on a
      // request that can never get a reply, delaying everything behind it for no reason.
      try {
        await Promise.race([
          this.sock?.logout(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8_000)),
        ]);
      } catch {
        /* the socket may already be closed, or WhatsApp didn't answer in time - either way, proceed */
      }
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
