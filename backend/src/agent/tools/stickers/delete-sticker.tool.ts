import type { Tool } from '../../tool-registry.js';
import { stickersModel } from '../../../models/stickers.model.js';

export const deleteStickerTool: Tool = {
  name: 'delete_sticker',
  description:
    'Elimina un sticker guardado por su etiqueta o su #id (solo administrador). Usa list_stickers primero si no ' +
    'estás seguro del nombre, o si hay varios con la misma etiqueta (ahí hace falta el #id).',
  parameters: {
    type: 'object',
    properties: {
      label: { type: 'string', description: 'Etiqueta del sticker a eliminar.' },
      id: { type: 'number', description: 'Id (#) del sticker, de list_stickers - necesario si varios comparten etiqueta.' },
    },
    additionalProperties: false,
  },

  async execute(args, ctx) {
    if (!ctx.isAdmin) return 'Solo el administrador puede hacer esto.';

    if (args.id !== undefined) {
      const sticker = stickersModel.getById(Number(args.id));
      if (!sticker) return `No encontré ningún sticker con el ⟦${args.id}⟧.`;
      stickersModel.delete(sticker.id);
      console.log('[TOOL] delete_sticker: deleted "%s" (#%d).', sticker.label, sticker.id);
      return `Listo, borré el sticker "${sticker.label ?? '(sin nombre)'}" (⟦${sticker.id}⟧).`;
    }

    const label = String(args.label ?? '').trim();
    if (!label) return 'Me falta la etiqueta o el #id del sticker a eliminar.';

    const matches = stickersModel.findLabelMatch(label);
    if (matches.length === 0) return `No encontré ningún sticker con la etiqueta "${label}".`;
    if (matches.length > 1) {
      return `Hay ${matches.length} stickers con la etiqueta "${matches[0].label}" (${matches.map((m) => `⟦${m.id}⟧`).join(', ')}) - dime cuál borrar por su #id.`;
    }

    stickersModel.delete(matches[0].id);
    console.log('[TOOL] delete_sticker: deleted "%s" (#%d).', matches[0].label, matches[0].id);
    return `Listo, borré el sticker "${matches[0].label}".`;
  },
};
