import { effectivePermissions, can, asBotUser, testModeOf, allowedToolsFor } from '../../services/permissions/permissions.service.js';
import { agendaView, agendaDateAsked } from '../../services/agenda/agenda.service.js';
import { handleTestModeCommand, testModeNotice } from '../../services/permissions/test-mode.service.js';
import { reminderPromptsModel } from '../../models/reminder-prompts.model.js';
import { applyAnswer, answerFromText } from '../../services/reminders/reminder-prompts.service.js';
import { sendMomentSticker, sendTurnSticker } from '../../services/stickers/stickers.service.js';
import { toWhatsApp } from '../../shared/utils/wa-format.js';
import { choicePromptsModel } from '../../models/choice-prompts.model.js';
import { splitChoices, choicesFor, withChoices, choicesHint, registerChoices, reactionAnswer, replyForReaction, replyForNumber, YES_NO } from '../../agent/choices.js';
import type { PromptAnswer, PromptSource, ReminderPrompt } from '../../entities/index.js';
import { jidNormalizedUser, downloadMediaMessage, type WAMessage } from 'baileys';
import { WaManager } from './wa-manager.js';
import { handleFashionMessage } from '../../services/fashion/fashion.router.js';
import { handleFashionReaction } from '../../services/fashion/fashion-reactions.js';
import type { FashionRouterResult } from '../../services/fashion/fashion-router.types.js';
import { usersModel } from '../../models/users.model.js';
import { messagesModel } from '../../models/messages.model.js';
import { stickersModel, normalizeStickerLabel, isWebp } from '../../models/stickers.model.js';
import { extractSharedContacts } from '../../shared/utils/vcard.js';
import { saveSharedContacts, undoSharedContacts, UNDO_CONTACTS_COMMAND } from '../../services/contacts/shared-contacts.service.js';
import { preferDesigned, listToolAsked } from '../../agent/views.js';
import { checklistAsked } from '../../agent/tools/shared/resolve-checklist.js';
import { handleAppointmentCommand, schedulingAsked } from '../../services/scheduling/scheduling-commands.js';
import { registry } from '../../agent/tool-registry.js';
import { remindersModel } from '../../models/reminders.model.js';
import { resetAllUserData, resetFashionData } from '../../services/users/reset-user.service.js';
import { spacesStorageService } from '../../services/fashion/storage/spaces-storage.service.js';
import { processMessage, takeLastTurnTools } from '../../agent/agent.js';
import { ensureWeeklyReportReminder } from '../../services/agenda/weekly-report.service.js';
import { ensureDailyResetReminder } from '../../services/conversation/daily-reset.service.js';
import { ensureDailyDedupReminder } from '../../services/maintenance/dedup.service.js';
import { legacyAdminToken } from '../../api/middleware/auth.middleware.js';
import { renderMainMenu, menuChoices, resolveMenuCategory, renderCategoryDetail, renderUnknownCategory } from '../../agent/menu.js';
import { isTwilioConfigured } from '../../services/calls/twilio-client.js';
import { handleModeMessage } from '../../agent/modes.js';
import { env } from '../../config/env.js';
import { sleep, typingDelayMs, readingPauseMs, withWorkingUpdates } from '../../shared/utils/human-delay.js';
import { workingUpdateMessage } from '../../shared/utils/motivational.js';
import { synthesizeVoiceNote } from '../../services/audio/tts.js';
import { extractDemoCode, activateDemo, isDemoExpired, demoEndedMessage } from '../../services/growth/demo.service.js';

/** How long a turn can run before the user gets a "still working on it" ping, and how many of
 *  those pings a single turn can rack up - see shared/utils/human-delay.ts's withWorkingUpdates(). Tuned
 *  so a normal one-or-two-tool-call reply (the vast majority) never triggers this at all; only a
 *  genuinely slow multi-iteration turn or a provider retry does. */
const WORKING_UPDATE_INTERVAL_MS = 12_000;
const WORKING_UPDATE_MAX_TICKS = 3;

const PRIVATE_BOT_REPLY =
  'Este es un asistente personal privado y no tienes acceso todavía. Pídele al administrador que te lo dé. 🙏';

const ERROR_REPLY =
  '⚠️ Tuve un problema técnico procesando tu mensaje. Ya quedó registrado, intenta de nuevo en un ' +
  'momento - si te sigue pasando seguido, avísale al administrador.';

/** Matches a short, unambiguous reply to the "¿eres hombre o mujer?" onboarding question - group 3
 *  is the actual word. Deliberately whole-message-only (never mid-sentence) so normal conversation
 *  that happens to contain "hombre"/"mujer" is never mistaken for answering it. */
const GENDER_REPLY_RE = /^(?:soy\s+)?(?:un\s+|una\s+)?(hombre|mujer|male|female|masculino|femenino)$/i;

/** A sticker name longer than this is treated as normal chat sent while a sticker was still waiting
 *  for its name, not as the name itself (see the pending-sticker block in handle()). */
const STICKER_LABEL_MAX_CHARS = 40;

/** Upper bound for a single message's handling before that chat's queue moves on (see
 *  BotManager.enqueueIncoming) - well above a slow-but-healthy AI turn (2 x 45s model timeout +
 *  tools + typing delay), so it only ever kicks in for something genuinely stuck. */
const CHAT_TURN_MAX_MS = 150_000;

const RESET_ALL_WARNING =
  '⚠️ Esto borra TODO tu contenido: recordatorios, rutinas, contactos, links, notas, categorías, ' +
  'premios/castigos e historial de chat - no se puede deshacer (tu acceso al bot no se toca). ' +
  'Si estás seguro, escribe exactamente:\n\n/reset todo confirmar';

const RESET_FASHION_WARNING =
  '⚠️ Esto borra TODO tu Fashion Mode: cada prenda de tu armario, tus outfits guardados y tu foto ' +
  'de referencia (junto con las fotos guardadas en la nube) - no se puede deshacer. El resto de tu ' +
  'contenido (recordatorios, tareas, etc.) no se toca. Si estás seguro, escribe exactamente:\n\n' +
  '/reset outfit confirmar';

const HELP_TEXT =
  'Comandos disponibles:\n\n' +
  '/menu - menú completo de todo lo que puedo hacer, organizado por categorías.\n' +
  '/reset - borra el historial de esta conversación (empezamos a "hablar" de cero, tu ' +
  'información sigue intacta).\n' +
  '/reset todo - borra TODA tu información (recordatorios, rutinas, contactos, links, notas, ' +
  'categorías, premios/castigos e historial) y empieza de cero. Pide confirmación antes de ' +
  'hacerlo, no se puede deshacer.\n' +
  '/reset outfit - borra TODO tu Fashion Mode (armario, outfits guardados, foto de referencia) sin ' +
  'tocar el resto de tu información. Pide confirmación antes de hacerlo, no se puede deshacer.\n' +
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

  /**
   * One promise chain per chat: messages from the SAME person are handled strictly one after the
   * other, never in parallel. Baileys fires each incoming batch as its own async event without
   * waiting on the previous one, so two quick messages ("prográmame X" + "¿qué pasó?") used to run
   * two AI turns at once - the second never saw the first one's reply/question and answered on
   * its own (real case: it scheduled "mañana 10pm" while the first turn was still asking whether
   * to). Different chats still run concurrently.
   */
  private chatQueues = new Map<string, Promise<void>>();

  constructor() {
    this.wa = new WaManager(env.wa.session);
    this.wa.onMessage((msg) => this.enqueueIncoming(msg));
    this.wa.onReaction((reaction) => this.handleReaction(reaction));
  }

  /**
   * An emoji reaction. On one of Fashion Mode's outfit photos or summaries it edits the outfit (see
   * services/fashion/fashion-reactions.ts). Otherwise only 👍 / 👎 mean something: on a reminder or
   * routine notice they mark it done / not done; on one of the bot's yes/no questions (see
   * agent/choices.ts) they count as the answer and go through the normal message pipeline as if
   * typed. Any other emoji, or a reaction to any other message, is just a reaction.
   */
  private async handleReaction({ jid, altJid, targetId, emoji }: { jid: string; altJid?: string; targetId: string; emoji: string }): Promise<void> {
    const { phoneJid } = await this.resolveIncomingIdentity(jid, altJid);
    const user = usersModel.getByJidOrLid(phoneJid) ?? usersModel.getByJidOrLid(jid);
    if (!user) return;

    if (env.fashion.enabled && can(asBotUser(user), 'fashion.use')) {
      // In the chat's queue, so it never interleaves with a message being handled.
      let handled = false;
      await this.enqueueTask(jid, async () => {
        const result = await handleFashionReaction({ userId: user.id, jid, targetId, emoji, wa: this.wa });
        if (!result) return;
        handled = true;
        console.log('[FASHION] User #%d reacted %s to an outfit message.', user.id, emoji);
        await this.sendFashionResult(user.id, jid, null, result);
      });
      if (handled) return;
    }

    const answer = reactionAnswer(emoji);
    if (!answer) return;

    const prompt = reminderPromptsModel.findByMessageId(user.id, targetId);
    if (prompt) {
      await this.recordPromptAnswer(jid, prompt, answer, 'reply');
      return;
    }

    const reply = replyForReaction(user.id, targetId, answer);
    if (reply === null) return;
    if (reply === 'stale') {
      await this.wa.sendText(jid, 'Esa pregunta ya quedó atrás 🙂 Dime qué necesitas ahora y lo vemos.').catch(() => {});
      return;
    }
    console.log('[CHOICES] User #%d reacted %s -> "%s".', user.id, emoji, reply);
    await this.enqueueIncoming({ jid, altJid, text: reply });
  }

  private async recordPromptAnswer(jid: string, prompt: ReminderPrompt, answer: PromptAnswer, source: PromptSource): Promise<void> {
    const result = applyAnswer(prompt, answer, source);
    console.log('[PROMPT] User #%d answered "%s" (%s) to "%s"%s.', prompt.user_id, answer, source, prompt.title, result ? '' : ' - no change');
    if (!result) return;
    await this.wa.sendText(jid, result.ack);
    if (result.celebrate) sendMomentSticker(this.wa, jid, 'routine_done');
  }

  /** Fashion Mode's answer: a plain reply, or photos + summary it sends itself; kept in the history either way. */
  private async sendFashionResult(userId: number, jid: string, userText: string | null, result: FashionRouterResult): Promise<void> {
    const sent = result.deliver ? await result.deliver() : result.reply;
    if (!result.deliver && result.reply) await this.wa.sendText(jid, result.reply);
    if (!sent) return;
    // Part of the same conversation: the model sees what was asked and shown here.
    if (userText?.trim()) messagesModel.add(userId, 'user', userText);
    messagesModel.add(userId, 'assistant', sent.length > 900 ? `${sent.slice(0, 900)}…` : sent);
  }

  /** Runs `task` after whatever this chat is already doing (same queue as incoming messages). */
  private enqueueTask(jid: string, task: () => Promise<void>): Promise<void> {
    const run = () => task().catch((err: unknown) => console.error('[BOT] Queued task failed for %s:', jid, (err as Error).message));
    const chain = (this.chatQueues.get(jid) ?? Promise.resolve()).then(run, run);
    this.chatQueues.set(jid, chain);
    void chain.finally(() => {
      if (this.chatQueues.get(jid) === chain) this.chatQueues.delete(jid);
    });
    return chain;
  }

  private enqueueIncoming(msg: Parameters<BotManager['handleIncoming']>[0]): Promise<void> {
    const key = msg.jid;
    const run = async () => {
      // A turn that somehow never settles must not freeze this chat forever - after the cap the
      // queue moves on (the stuck turn keeps running in the background and can still reply).
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        this.handleIncoming(msg),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            console.error('[BOT] Turn of %s exceeded %ds, releasing the chat queue.', key, CHAT_TURN_MAX_MS / 1000);
            // Never leave the person waiting in silence (agent.ts's own turn budget should end
            // well before this - this only fires for something stuck outside the AI loop).
            void this.wa
              .sendText(msg.jid, '⚠️ Me estoy demorando más de la cuenta con eso. Dame un momento y pregúntame cómo quedó antes de repetirlo.')
              .catch(() => {});
            resolve();
          }, CHAT_TURN_MAX_MS);
        }),
      ]).finally(() => clearTimeout(timer));
    };
    const chain = (this.chatQueues.get(key) ?? Promise.resolve()).then(run, run);
    this.chatQueues.set(key, chain);
    void chain.finally(() => {
      if (this.chatQueues.get(key) === chain) this.chatQueues.delete(key);
    });
    return chain;
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
  private async resolveIncomingIdentity(rawJid: string, altJid?: string): Promise<{ phoneJid: string; lid: string | null }> {
    if (!rawJid.endsWith('@lid')) return { phoneJid: jidNormalizedUser(rawJid), lid: null };
    // The message itself usually carries the phone jid (key.remoteJidAlt) - more reliable than the
    // local lid store, which was empty for the admin and left their LID stored as "their number".
    if (altJid?.endsWith('@s.whatsapp.net')) return { phoneJid: jidNormalizedUser(altJid), lid: rawJid };
    const resolved = await this.wa.resolveLidToPhoneJid(rawJid);
    return { phoneJid: jidNormalizedUser(resolved ?? rawJid), lid: rawJid };
  }

  private async handleIncoming({
    jid,
    altJid,
    name,
    text,
    fromAudio,
    imageMessage,
    documentMessage,
    stickerMessage,
    contactMessage,
    quotedId,
  }: {
    jid: string;
    altJid?: string;
    name?: string;
    text: string;
    fromAudio?: boolean;
    imageMessage?: WAMessage;
    documentMessage?: WAMessage;
    stickerMessage?: WAMessage;
    contactMessage?: WAMessage;
    quotedId?: string;
  }) {
    // Everything below can fail in ways that have nothing to do with the user's message itself
    // (AI provider hiccup, a bug, WhatsApp acting up) - wrapping the whole thing means there is
    // always either a real reply or this error notice, never just silence while they wait.
    try {
      const { phoneJid, lid } = await this.resolveIncomingIdentity(jid, altJid);
      console.log(
        '[BOT] Incoming message from %s%s%s: "%s"',
        phoneJid,
        lid ? ` (lid ${lid})` : '',
        fromAudio ? ' [audio]' : '',
        text.length > 200 ? `${text.slice(0, 200)}…` : text,
      );

      if (!usersModel.hasAny()) {
        const admin = usersModel.create({ jid: phoneJid, name: name ?? null, role: 'admin' });
        if (lid) usersModel.setLid(phoneJid, lid);
        ensureWeeklyReportReminder(admin.id, admin.jid);
        ensureDailyResetReminder(admin.id, admin.jid);
        ensureDailyDedupReminder(admin.id, admin.jid);
        // Seeded from the legacy single-token source (env ADMIN_TOKEN or auth_info/admin-token.txt)
        // rather than a fresh random one, so whatever's already printed/configured for the admin
        // works immediately - see api/middleware/auth.middleware.ts.
        const panelToken = legacyAdminToken();
        usersModel.setPanelToken(admin.id, panelToken);
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
        console.log('[AUTH] Administrator access token: %s', panelToken);

        // One-shot onboarding question (the user's own ask) instead of silently guessing from the
        // name or never asking at all - answered by the short-reply interceptor further down
        // ("hombre"/"mujer"), which sets both the grammatical gender AND the default voice together.
        await this.wa
          .sendText(
            admin.jid,
            '👋 ¡Hola! Soy Canix, tu asistente virtual. Antes de arrancar: ¿eres hombre o mujer? Así te ' +
              'hablo en el género correcto y uso la voz que corresponde en las notas de voz (respóndeme ' +
              'solo "hombre" o "mujer").',
          )
          .catch(() => {});
      }

      let user = usersModel.getByJidOrLid(phoneJid) ?? usersModel.getByJidOrLid(jid);
      if (user && lid && !user.lid) usersModel.setLid(user.jid, lid); // fill in a lid we hadn't captured yet
      // Someone registered under their @lid (number unknown back then) whose real number we now
      // know: store the real number, so the portal login and every "tu número" message use it.
      if (user && user.jid.endsWith('@lid') && phoneJid.endsWith('@s.whatsapp.net')) {
        if (usersModel.setPhoneJid(user.id, phoneJid)) {
          console.log('[BOT] User #%d: real number %s saved (only had their LID %s before).', user.id, phoneJid, user.jid);
          user = usersModel.getById(user.id)!;
        }
      }

      // A free demo requested on the landing page: the visitor sends the code from their own
      // WhatsApp, which both proves the number is theirs and keeps the bot replying, never cold-
      // messaging (see services/growth/demo.service.ts).
      if (!user) {
        const demoCode = extractDemoCode(text);
        if (demoCode && phoneJid.endsWith('@s.whatsapp.net')) {
          if (await activateDemo({ code: demoCode, phoneJid, lid, pushName: name, wa: this.wa })) return;
          await this.wa.sendText(
            jid,
            `Ese código (${demoCode}) no existe o ya se usó/venció. Pide uno nuevo en la página de Canix, o escríbenos: https://wa.me/${env.growth.contactWhatsapp}`,
          );
          return;
        }
      }

      if (!user) {
        console.log('[BOT] %s has no access, answering with the generic message.', phoneJid);
        await this.wa.sendText(jid, PRIVATE_BOT_REPLY);
        return;
      }

      console.log('[BOT] Resolved user: #%d "%s" (%s)', user.id, user.name ?? '(no name)', user.role);

      // A bare number answers the numbered question that's waiting, if there is one (see
      // agent/choices.ts). Either way the conversation moved on: earlier questions stop waiting.
      const numbered = text ? replyForNumber(user.id, text) : null;
      choicePromptsModel.closeOpenFor(user.id);
      if (numbered) {
        console.log('[CHOICES] User #%d answered "%s" -> "%s".', user.id, text.trim(), numbered);
        await this.handleIncoming({ jid, altJid, name, text: numbered, fromAudio });
        return;
      }

      // Demo over: no more AI turns (each one costs) - just the way to become a customer.
      if (isDemoExpired(user)) {
        await this.wa.sendText(jid, demoEndedMessage(user));
        return;
      }

      const command = text.trim().toLowerCase();

      // Modo prueba (see services/permissions/test-mode.service.ts): the administrator's own commands to try the bot
      // with a reduced set of permissions and to come back - raw commands, so getting out never
      // depends on what the set being tried allows.
      if (user.role === 'admin' && !stickerMessage) {
        const testReply = handleTestModeCommand(user, text);
        if (testReply) {
          await this.wa.sendText(jid, testReply);
          return;
        }
      }
      // From here on the bot treats an administrator in test mode as the ordinary user they're
      // simulating; `user` stays the real record for what only the real admin does (sticker pack).
      const botUser = asBotUser(user);
      const testMode = testModeOf(user);

      // "sí"/"no" typed as a reply to a reminder: same as reacting to it.
      if (quotedId) {
        const quotedAnswer = answerFromText(text);
        const prompt = quotedAnswer ? reminderPromptsModel.findByMessageId(user.id, quotedId) : undefined;
        if (prompt && quotedAnswer) {
          await this.recordPromptAnswer(jid, prompt, quotedAnswer, 'reply');
          return;
        }
      }

      // Sticker pack (see agent/tools/stickers/send-sticker.tool.ts) - only the admin can teach the bot a
      // new one, by sending it as a real WhatsApp sticker. Checked before everything else below:
      // a sticker carries no meaningful text, and Fashion Mode/the mode router have nothing to do
      // with it either way.
      if (stickerMessage) {
        if (user.role === 'admin') {
          try {
            const data = (await downloadMediaMessage(stickerMessage, 'buffer', {})) as Buffer;
            const mimetype = stickerMessage.message?.stickerMessage?.mimetype ?? 'image/webp';

            // Only WebP can be sent back as a sticker (see stickers.model.ts's isWebp) - saving a
            // Lottie/other one would just make every later send of it fail silently.
            if (!isWebp(data)) {
              console.warn('[STICKER] Admin sticker ignored: unsupported format (%s).', mimetype);
              await this.wa.sendText(
                jid,
                '⚠️ Ese sticker es de un formato que WhatsApp no me deja reenviar (los animados nuevos tipo Lottie). Prueba con otro.',
              );
              return;
            }

            const existing = stickersModel.findByData(data);
            if (existing) {
              await this.wa.sendText(
                jid,
                existing.label
                  ? `👌 Ese sticker ya lo tengo guardado como "${existing.label}".`
                  : '👌 Ese sticker ya lo recibí y está esperando nombre.',
              );
              return;
            }

            const saved = stickersModel.createPending(user.id, data, mimetype);
            const pendingCount = stickersModel.countPendingFor(user.id);
            console.log('[STICKER] Sticker #%d received from admin #%d, waiting for a label (%d queued).', saved.id, user.id, pendingCount);
            await this.wa.sendText(
              jid,
              pendingCount === 1
                ? '🏷️ Sticker recibido. ¿Con qué nombre lo guardo? Usa un nombre que diga cuándo usarlo ' +
                    '(ej. "buenos dias", "celebracion", "buenas noches", "motivacion", "gato feliz"). ' +
                    'Escribe "cancelar" si no lo quieres guardar.'
                : `🏷️ Recibido, queda en cola (${pendingCount} sin nombre). Los nombres que me escribas se aplican en el ` +
                    'orden en que me mandaste los stickers - te reenvío cada uno cuando toque.',
            );
          } catch (err) {
            console.error('[STICKER] Error downloading the admin sticker:', (err as Error).message);
            await this.wa.sendText(jid, '⚠️ No pude descargar ese sticker, intenta de nuevo.').catch(() => {});
          }
        }
        return; // nothing else to do with this turn either way
      }

      // If the admin sent a sticker and hasn't named it yet, their next plain-text message (not a
      // raw command like /menu) is that label - applied to the OLDEST pending one, so a burst of
      // stickers gets named in the order sent. Checked early for the same reason as above.
      const pendingSticker = user.role === 'admin' ? stickersModel.getPendingFor(user.id) : undefined;
      if (pendingSticker && text.trim() && !command.startsWith('/')) {
        const raw = text.trim();
        const label = normalizeStickerLabel(raw);

        if (/^(cancelar|cancela|descartar|descarta|no lo guardes|borralo|bórralo)$/i.test(raw)) {
          stickersModel.delete(pendingSticker.id);
          console.log('[STICKER] Sticker #%d discarded by the admin.', pendingSticker.id);
          await this.wa.sendText(jid, '🗑️ Listo, no lo guardé.');
        } else if (!label || raw.length > STICKER_LABEL_MAX_CHARS || raw.includes('?')) {
          // A full sentence/question is almost certainly normal chat, not a name - don't silently
          // save "recuérdame comprar pan mañana" as a sticker label; ask instead.
          await this.wa.sendText(
            jid,
            '🏷️ Tengo un sticker esperando nombre. Mándame solo un nombre corto (ej. "celebracion", ' +
              '"buenas noches") o "cancelar" para descartarlo, y seguimos.',
          );
          await this.wa.sendSticker(jid, pendingSticker.data).catch(() => {});
          return;
        } else {
          stickersModel.setLabel(pendingSticker.id, label);
          console.log('[STICKER] Sticker #%d labeled "%s".', pendingSticker.id, label);
          await this.wa.sendText(jid, `✅ Guardado como "${label}" - lo uso cuando calce en la conversación, sin que me lo pidas.`);
        }

        const next = stickersModel.getPendingFor(user.id);
        if (next) {
          await this.wa.sendSticker(jid, next.data).catch(() => {});
          await this.wa.sendText(jid, '🏷️ ¿Y este cómo se llama? (o "cancelar")');
        }
        return;
      }

      // Answer to the onboarding "¿eres hombre o mujer?" question (sent on first contact - see the
      // admin-bootstrap block above and grant_access.tool.ts) - a short, unambiguous reply, handled
      // here deterministically (zero AI tokens) instead of leaving it to the AI's own set_user_gender
      // tool, which by design only infers it from an unambiguous NAME and otherwise stays neutral.
      // Also fires for anyone who never got asked but just says it unprompted. Sets both the
      // grammatical gender AND (if not already chosen) the voice for notes, together, in one answer.
      if (!user.gender && GENDER_REPLY_RE.test(command)) {
        const word = command.match(GENDER_REPLY_RE)![1].toLowerCase();
        const gender: 'male' | 'female' = word === 'mujer' || word === 'female' || word === 'femenino' ? 'female' : 'male';
        usersModel.setGender(user.id, gender);
        if (!user.voice_gender) usersModel.setVoiceGender(user.id, gender);
        console.log('[BOT] User #%d set their gender to "%s" (short answer).', user.id, gender);
        await this.wa.sendText(
          jid,
          gender === 'female'
            ? '✅ Listo, te hablo en femenino y uso voz de mujer en las notas de voz (puedes pedirme cambiar la voz cuando quieras).'
            : '✅ Listo, te hablo en masculino y uso voz de hombre en las notas de voz (puedes pedirme cambiar la voz cuando quieras).',
        );
        return;
      }

      // Shared WhatsApp contact card(s) (native "share contact" feature, see shared/utils/vcard.ts) - works
      // for anyone, not admin-only (sharing your own contacts is a normal action). Nothing is saved
      // yet: only offered, and only actually written to `contacts` once the person replies "sí"
      // (see the pending-batch reply handler right below).
      if (contactMessage) {
        if (!can(botUser, 'contacts.manage')) {
          await this.wa.sendText(jid, '🔒 Guardar contactos no está habilitado para ti. Si lo necesitas, pídeselo al administrador.');
          return;
        }
        const shared = extractSharedContacts(contactMessage);
        if (shared.length === 0) {
          await this.wa
            .sendText(jid, '⚠️ Esa tarjeta de contacto no trae número, así que no pude guardarla. Escríbeme el nombre y el número y lo guardo.')
            .catch(() => {});
          return;
        }
        // Sharing the card is the request to save it - saved right away, with a 👎 to undo.
        const { text: savedText, newIds } = await saveSharedContacts(this.wa, user.id, shared);
        console.log('[CONTACTS] User #%d shared %d contact(s): %d new.', user.id, shared.length, newIds.length);
        messagesModel.add(user.id, 'assistant', savedText);
        const savedId = await this.wa.sendTextWithId(jid, savedText);
        if (newIds.length > 0) {
          registerChoices(user.id, savedId, { options: [{ label: '', reply: '' }, { label: 'Quitar', reply: `${UNDO_CONTACTS_COMMAND} ${newIds.join(',')}` }], binary: true, sticky: true });
        }
        return;
      }

      // The 👎 on that confirmation (see services/contacts/shared-contacts.service.ts).
      if (command.startsWith(`${UNDO_CONTACTS_COMMAND} `)) {
        const ids = command.slice(UNDO_CONTACTS_COMMAND.length).split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
        const undone = undoSharedContacts(user.id, ids);
        messagesModel.add(user.id, 'assistant', undone);
        await this.wa.sendText(jid, undone);
        return;
      }

      if (command === '/reset') {
        messagesModel.clear(user.id);
        await this.wa.sendText(jid, '🧹 Historial de conversación borrado.');
        return;
      }

      if (command === '/reset todo') {
        await this.wa.sendText(jid, RESET_ALL_WARNING);
        return;
      }

      if (command === '/reset todo confirmar') {
        resetAllUserData(user.id);
        console.log('[BOT] #%d asked for /reset todo confirmar - all their data was deleted.', user.id);
        await this.wa.sendText(jid, '🗑️ Listo, borré todo tu contenido. Seguimos desde cero.');
        return;
      }

      if (command === '/reset outfit') {
        await this.wa.sendText(jid, RESET_FASHION_WARNING);
        return;
      }

      if (command === '/reset outfit confirmar') {
        const { garmentsDeleted, outfitsDeleted, storageKeys } = resetFashionData(user.id);
        // Best-effort: an orphaned Spaces object is harmless (see spacesStorageService.delete's own
        // comment) - the DB rows are already gone either way, so a Spaces hiccup here never leaves
        // the user's armario half-deleted or blocks the confirmation.
        await spacesStorageService.delete(storageKeys).catch((err) => {
          console.error('[BOT] #%d: failed cleaning Spaces photos after /reset outfit:', user.id, (err as Error).message);
        });
        console.log(
          '[BOT] #%d pidio /reset outfit confirmar - %d prenda(s), %d outfit(s), %d foto(s) borradas.',
          user.id,
          garmentsDeleted,
          outfitsDeleted,
          storageKeys.length,
        );
        await this.wa.sendText(
          jid,
          `🗑️ Listo, borré tu Fashion Mode completo (${garmentsDeleted} prenda(s), ${outfitsDeleted} outfit(s) ` +
            `guardado(s)). Arrancamos de cero - mandame una foto cuando quieras agregar tu primera prenda.`,
        );
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
        const access = { fashionEnabled: env.fashion.enabled, callsEnabled: isTwilioConfigured(), isAdmin: botUser.role === 'admin', permissions: effectivePermissions(botUser) };
        const menuId = await this.wa.sendTextWithId(jid, renderMainMenu(access) + (testMode ? `\n\n${testModeNotice(testMode)}` : ''));
        registerChoices(user.id, menuId, { options: menuChoices(access), binary: false });
        return;
      }
      if (command.startsWith('/menu ')) {
        const access = { fashionEnabled: env.fashion.enabled, callsEnabled: isTwilioConfigured(), isAdmin: botUser.role === 'admin', permissions: effectivePermissions(botUser) };
        const category = resolveMenuCategory(command.slice('/menu '.length), access);
        await this.wa.sendText(jid, category ? renderCategoryDetail(category) : renderUnknownCategory(access));
        return;
      }

      // Fashion Mode (armario/outfits, see backend/src/services/fashion/) - entirely gated behind this flag, and
      // the `&&` short-circuits before ever touching fashion_sessions, so a disabled deploy has
      // zero behavior change here. Runs BEFORE the AI loop (pure state-machine, no tokens spent)
      // for exactly the same reason the /reset-style commands above do - a structured wizard step
      // (a numbered menu choice, a photo) doesn't need a model in the loop.
      if (env.fashion.enabled && can(botUser, 'fashion.use')) {
        const result = await handleFashionMessage({ userId: user.id, jid, text, imageMessage, documentMessage, wa: this.wa });
        if (result.consumed) {
          await this.sendFashionResult(user.id, jid, text, result);
          return;
        }
        if (result.forward) text = result.forward;
      }
      // Sections (routines/to-dos/notes/contacts/meals/rewards/summaries) - see agent/modes.ts.
      // Also zero-token, same plain-command pattern as everything above. Runs after Fashion Mode
      // (a fully separate island) so its own "salir"/entry keywords never collide with these.
      const modeResult = handleModeMessage(user.id, text);
      if (modeResult.consumed) {
        if (modeResult.reply) await this.wa.sendText(jid, modeResult.reply);
        return;
      }

      if (!text.trim()) return; // bare image, not consumed by Fashion - same silent-ignore as before this feature existed

      // "Mis links", "qué recordatorios tengo"...: the designed list straight from the data (see
      // agent/views.ts) - no AI turn. Kept in the history (with each item's internal ref) so "borra el segundo" right after makes sense.
      const botTools = allowedToolsFor(botUser);
      // "confirmar cita 12" (typed, or a 👍 on the request) is done on the spot - see services/scheduling/scheduling-commands.ts.
      const appointmentReply = await handleAppointmentCommand(user, text, botTools);
      if (appointmentReply) {
        messagesModel.add(user.id, 'user', text);
        messagesModel.add(user.id, 'assistant', appointmentReply);
        await this.wa.sendText(jid, appointmentReply);
        return;
      }
      // One of the person's lists by its name comes first: "mis pendientes" is their list called
      // "Pendientes" when they have one, not the to-dos.
      const namedList = checklistAsked(user.id, text);
      const listAsk = (namedList ? { tool: 'view_list', args: { list: String(namedList) } } : null) ?? listToolAsked(text) ?? schedulingAsked(text, user.id, botTools);
      const listTool = listAsk?.tool;
      if (listAsk && listTool && (botTools === null || botTools.includes(listTool))) {
        const listText = await registry.get(listTool)!.execute(listAsk.args, { ownerJid: user.jid, userId: user.id, isAdmin: botUser.role === 'admin', wa: this.wa });
        messagesModel.add(user.id, 'user', text);
        messagesModel.add(user.id, 'assistant', listText);
        remindersModel.confirmForUser(user.id);
        await this.wa.sendText(jid, listText);
        return;
      }

      // "¿Qué tengo hoy / mañana / el viernes?" gets the designed agenda directly (see services/agenda/agenda.service.ts) - no AI turn. Kept
      // in the conversation history so a "sí" to the rescheduling offer makes sense to the model.
      const agendaDate = agendaDateAsked(text);
      const fullAgenda = botTools === null || botTools.includes('get_today_agenda');
      const onlyAppointments = !fullAgenda && !!botTools && (botTools.includes('list_appointments') || botTools.includes('list_my_appointments'));
      if (agendaDate && (fullAgenda || onlyAppointments)) {
        const view = agendaView(user.id, agendaDate, { personal: fullAgenda, reminders: !!botTools?.includes('list_reminders') });
        const offer = view.unmarked > 0 ? '¿Quieres que te reprograme alguna de las que quedaron sin marcar?' : null;
        const agendaText = offer ? `${view.text}\n\n${offer}` : view.text;
        messagesModel.add(user.id, 'user', text);
        messagesModel.add(user.id, 'assistant', agendaText);
        remindersModel.confirmForUser(user.id);
        const agendaId = await this.wa.sendTextWithId(jid, withChoices(agendaText, offer ? YES_NO : null));
        if (offer) registerChoices(user.id, agendaId, YES_NO);
        return;
      }

      // Brief human-like pauses (see shared/utils/human-delay.ts) so replies don't land instantly on
      // every message - an obviously scripted response pattern is one of the signals that
      // increases spam/ban risk, on top of just feeling robotic.
      await sleep(readingPauseMs());
      await this.wa.sendTyping(jid);

      // processMessage() already catches AI-provider failures internally and returns a friendly
      // message instead of throwing (see agent.ts's callModelWithRetry) - the outer try/catch
      // here is the last-resort net for anything else unexpected.
      const rawReply = await withWorkingUpdates(
        processMessage(text, this.wa, {
          id: user.id,
          jid: user.jid,
          isAdmin: botUser.role === 'admin',
        }),
        async () => {
          await this.wa.sendTyping(jid).catch(() => {});
          await this.wa.sendText(jid, workingUpdateMessage()).catch(() => {});
        },
        { intervalMs: WORKING_UPDATE_INTERVAL_MS, maxTicks: WORKING_UPDATE_MAX_TICKS },
      );
      // A closed question at the end of the reply can be answered with a reaction or a number
      // (see agent/choices.ts) - the hint goes in the same message, no extra one.
      const turnTools = takeLastTurnTools(user.id);
      const split = splitChoices(toWhatsApp(rawReply));
      const asked = split.choices;
      // A list the model re-typed its own way goes out in its designed form (see agent/views.ts).
      const reply = preferDesigned(split.text, turnTools);
      // The menu shown through the AI (show_menu) answers to its numbers like /menu does.
      const menuShown = !choicesFor(reply, asked) && turnTools.some((t) => t.name === 'show_menu');
      const menuAccess = { fashionEnabled: env.fashion.enabled, callsEnabled: isTwilioConfigured(), isAdmin: botUser.role === 'admin', permissions: effectivePermissions(botUser) };
      // ...and only under a reply that really ends in a question (see choicesFor).
      const choices = choicesFor(reply, asked);
      const sendReplyText = async () => {
        const id = await this.wa.sendTextWithId(jid, withChoices(reply, choices));
        if (choices) registerChoices(user.id, id, choices);
        else if (menuShown) registerChoices(user.id, id, { options: menuChoices(menuAccess), binary: false });
      };
      console.log('[BOT] Final reply to #%d: "%s"', user.id, reply.length > 200 ? `${reply.slice(0, 200)}…` : reply);
      await sleep(typingDelayMs(reply));

      if (fromAudio) {
        // Asked by voice -> answer with voice only, no text (see services/audio/tts.ts), using this
        // person's preferred voice (set_voice_gender) - the natural Fish Audio voice when they hold
        // the paid 'voice.premium' permission, local Piper otherwise. Best-effort: if synthesis
        // fails (or the reply is too long for a note), fall back to the text reply so the answer
        // isn't lost - never send both when the voice note actually went out.
        const voice = await synthesizeVoiceNote(reply, user.voice_gender, {
          premium: can(botUser, 'voice.premium'),
          userId: user.id,
          voiceId: user.voice_id,
        }).catch(() => null);
        if (voice) {
          try {
            await this.wa.sendAudio(jid, voice);
            // A voice note can't carry the hint, so the options follow as one short line.
            if (choices) registerChoices(user.id, await this.wa.sendTextWithId(jid, choicesHint(choices)), choices);
          } catch (err) {
            console.error('[BOT] Error sending voice note:', (err as Error).message);
            await sendReplyText();
          }
        } else {
          await sendReplyText();
        }
      } else {
        await sendReplyText();
      }

      // A sticker that fits what just happened (a successful action, or a greeting/thanks/goodbye)
      // - after the reply, so it reads as the closing touch. Same cooldown as every sticker.
      sendTurnSticker(this.wa, jid, { userText: text, tools: turnTools });
    } catch (err) {
      console.error('[BOT] Unexpected error handling a message from %s:', jid, (err as Error).message);
      await this.wa.sendText(jid, ERROR_REPLY).catch((sendErr) => {
        console.error('[BOT] Could not report the error either:', (sendErr as Error).message);
      });
    }
  }
}
