import type { Tool } from '../tool-registry.js';
import { stickersRepo } from '../../db/repositories/stickers.repo.js';
import { sendPackSticker, stickerOnCooldown } from '../../util/stickers.js';

/**
 * Lets the AI agent send a sticker from the bot's pack (see bot-manager.ts's admin-upload flow)
 * ON ITS OWN, when the moment fits - never because the person asked for one. The available labels
 * are listed directly in the system prompt (see ai-agent.ts's buildSystemPrompt), so the model
 * doesn't need a separate lookup call first.
 */
export const sendStickerTool: Tool = {
  name: 'send_sticker',
  description:
    'Envía un sticker de la colección guardada, cuando el momento de la conversación lo amerite (saludo, ' +
    'celebración, motivación, despedida, etc. - según las etiquetas que ves en tu contexto). Úsala por tu cuenta, ' +
    'SIN preguntar si quiero uno - si ninguna etiqueta calza con este momento, simplemente no la uses.',
  parameters: {
    type: 'object',
    properties: {
      label: {
        type: 'string',
        description: 'La etiqueta del sticker a enviar, copiada tal cual de "Stickers disponibles" en tu contexto - nunca inventes una.',
      },
    },
    required: ['label'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const label = String(args.label ?? '').trim();
    if (!label) return 'Me falta la etiqueta del sticker.';

    // Shared with the automatic celebration/night stickers (util/stickers.ts) - stops the agent
    // from doubling a sticker complete_todo/checkin_routine already sent this same turn.
    if (stickerOnCooldown(ctx.ownerJid)) {
      return 'Ya se envió un sticker hace muy poco en este chat - no mandes otro ahora, sigue solo con texto.';
    }

    // Tolerant lookup (accents/spaces/emoji/partial name - see stickers.repo.ts's findLabelMatch),
    // so a slightly-off label from the model still sends the right sticker instead of failing.
    const sticker = stickersRepo.getByLabel(label);
    if (!sticker) {
      const available = stickersRepo.distinctLabels();
      console.warn('[TOOL] send_sticker: etiqueta "%s" no existe.', label);
      return available.length
        ? `No hay ningún sticker "${label}". Las únicas etiquetas válidas son: ${available.join(', ')}. ` +
            'Si ninguna calza con el momento, no mandes sticker.'
        : 'No hay stickers guardados todavía - no mandes ninguno.';
    }

    try {
      await sendPackSticker(ctx.wa, ctx.ownerJid, sticker);
      return `Listo, mandé el sticker "${sticker.label}".`;
    } catch (err) {
      console.error('[TOOL] send_sticker: fallo enviando "%s":', sticker.label, (err as Error).message);
      return `No pude enviar el sticker "${sticker.label}".`;
    }
  },
};
