import type { Tool } from '../tool-registry.js';
import { contactsRepo } from '../../db/repositories/contacts.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const editContactTool: Tool = {
  name: 'edit_contact',
  description:
    'Edita el nombre, notas y/o @username de un contacto ya guardado. Para cambiarle el número, usa add_contact ' +
    'de nuevo con el número nuevo (queda como un contacto aparte) - el número es la identidad del contacto, no se edita aquí.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id del contacto (ver list_contacts).' },
      name: { type: 'string', description: 'Nuevo nombre (opcional).' },
      notes: { type: 'string', description: 'Nueva nota (opcional).' },
      username: { type: 'string', description: 'Nuevo @username de WhatsApp, sin el @ (opcional).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para editar SU contacto en vez del tuyo.',
      },
    },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const id = Number(args.id);
    const contact = contactsRepo.getById(userId, id);
    if (!contact) return `No encontré el contacto #${id}.`;

    contactsRepo.update(userId, id, {
      name: args.name ? String(args.name).trim() : undefined,
      notes: args.notes !== undefined ? String(args.notes) : undefined,
      username: args.username !== undefined ? String(args.username).trim().replace(/^@/, '') : undefined,
    });

    const updated = contactsRepo.getById(userId, id)!;
    return `Listo, actualicé el contacto #${id}: "${updated.name}"${updated.username ? ` (@${updated.username})` : ''}.`;
  },
};
