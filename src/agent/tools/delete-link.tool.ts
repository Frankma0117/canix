import type { Tool } from '../tool-registry.js';
import { linksRepo } from '../../db/repositories/links.repo.js';

export const deleteLinkTool: Tool = {
  name: 'delete_link',
  description:
    'Elimina un link por su id (usa list_links o search primero para confirmar cuál es antes de borrar).',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id del link a eliminar.' },
    },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args) {
    const id = Number(args.id);
    const link = linksRepo.getById(id);
    if (!link) return `No encontré el link #${id}.`;
    linksRepo.remove(id);
    return `Link #${id} (${link.url}) eliminado.`;
  },
};
