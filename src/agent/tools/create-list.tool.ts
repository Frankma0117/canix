import type { Tool } from '../tool-registry.js';
import { checklistsRepo } from '../../db/repositories/checklists.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const createListTool: Tool = {
  name: 'create_list',
  description:
    'Crea una lista nueva para ir marcando cosas de a poco - ej. "juegos de Mario que quiero", "películas por ver", ' +
    '"libros pendientes", "cosas para comprar". Distinta de una tarea suelta (add_todo): es una colección a la que ' +
    'luego se le agregan ítems (add_list_item) y se van marcando uno por uno (check_list_item), sin fecha ni hora.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nombre de la lista, ej. "Juegos de Mario".' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para crearle la lista a ella en vez de a ti.',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const name = String(args.name ?? '').trim();
    if (!name) return 'Me falta el nombre de la lista.';

    const existing = checklistsRepo.findByName(userId, name).find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (existing) return `Ya tienes una lista llamada "${existing.name}" (#${existing.id}) - usa add_list_item para agregarle cosas.`;

    const id = checklistsRepo.create(userId, name);
    return `Listo, creé la lista "${name}" (#${id}) 📋 - decime qué agregar y lo hago con add_list_item.`;
  },
};
