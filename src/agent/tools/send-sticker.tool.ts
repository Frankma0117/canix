import type { Tool } from '../tool-registry.js';
import { stickersRepo } from '../../db/repositories/stickers.repo.js';

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
      label: { type: 'string', description: 'La etiqueta EXACTA del sticker a enviar, de las que ves en tu contexto.' },
    },
    required: ['label'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const label = String(args.label ?? '').trim();
    if (!label) return 'Me falta la etiqueta del sticker.';

    const sticker = stickersRepo.getByLabel(label);
    if (!sticker) return `No tengo ningún sticker guardado con la etiqueta "${label}".`;

    try {
      await ctx.wa.sendSticker(ctx.ownerJid, sticker.data);
      console.log('[TOOL] send_sticker: enviado "%s" a %s.', label, ctx.ownerJid);
      return `Listo, mandé el sticker "${label}".`;
    } catch (err) {
      console.error('[TOOL] send_sticker: fallo enviando "%s":', label, (err as Error).message);
      return `No pude enviar el sticker "${label}".`;
    }
  },
};
