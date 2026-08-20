import type { Tool } from '../tool-registry.js';
import { stickersRepo } from '../../db/repositories/stickers.repo.js';

export const deleteStickerTool: Tool = {
  name: 'delete_sticker',
  description: 'Elimina un sticker guardado por su etiqueta (solo administrador). Usa list_stickers primero si no estás seguro del nombre exacto.',
  parameters: {
    type: 'object',
    properties: {
      label: { type: 'string', description: 'Etiqueta del sticker a eliminar.' },
    },
    required: ['label'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    if (!ctx.isAdmin) return 'Solo el administrador puede hacer esto.';
    const label = String(args.label ?? '').trim();
    if (!label) return 'Me falta la etiqueta del sticker a eliminar.';

    const sticker = stickersRepo.getByLabel(label);
    if (!sticker) return `No encontré ningún sticker con la etiqueta "${label}".`;

    stickersRepo.delete(sticker.id);
    console.log('[TOOL] delete_sticker: eliminado "%s" (#%d).', label, sticker.id);
    return `Listo, borré el sticker "${label}".`;
  },
};
