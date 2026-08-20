import type { Tool } from '../tool-registry.js';
import { stickersRepo } from '../../db/repositories/stickers.repo.js';

export const listStickersTool: Tool = {
  name: 'list_stickers',
  description: 'Lista los stickers guardados con su etiqueta (solo administrador) - útil antes de delete_sticker.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },

  async execute(_args, ctx) {
    if (!ctx.isAdmin) return 'Solo el administrador puede ver esto.';
    const stickers = stickersRepo.listAll();
    if (stickers.length === 0) return 'Todavía no hay stickers guardados - mándame uno directo por WhatsApp para empezar.';
    return stickers.map((s) => `- ${s.label} (#${s.id})`).join('\n');
  },
};
