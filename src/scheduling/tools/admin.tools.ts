import type { Tool } from '../../agent/tool-registry.js';
import { can } from '../../permissions/engine.js';
import { schedRepo } from '../repo.js';
import { shareAccess, professionalLabel, SchedulingError } from '../service.js';
import { schedTool, strOrNull } from './common.js';
import { resolveUserByQuery } from '../../agent/tools/resolve-user.js';

function resolveGroup(ref: unknown) {
  const r = String(ref ?? '').trim();
  const g = schedRepo.getGroup(/^#?\d+$/.test(r) ? Number(r.replace('#', '')) : r);
  if (!g) throw new SchedulingError(`No existe el grupo "${r}".`);
  return g;
}

function resolveProfessional(query: unknown) {
  const r = resolveUserByQuery(String(query ?? ''), { allowAdmin: true });
  if ('error' in r) throw new SchedulingError(r.error);
  if (!can(r.user, 'scheduling.professional')) throw new SchedulingError(`${r.user.name} no tiene el permiso de agenda de profesional.`);
  return schedRepo.getProfessional(r.user.id) ?? schedRepo.createProfessional(r.user.id, r.user.name ?? 'Profesional');
}

export const manageSchedulingGroupTool: Tool = schedTool({
  name: 'manage_scheduling_group',
  description:
    'Gestiona las agendas generales (grupos de profesionales, ej. un consultorio) - solo administrador. Acciones: ' +
    'list, create, update, delete, add_professional, remove_professional, share_with_client (da acceso a un número ' +
    'para agendar con cualquier profesional del grupo).',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'create', 'update', 'delete', 'add_professional', 'remove_professional', 'share_with_client'] },
      group: { type: 'string', description: 'Nombre o #id del grupo (todas menos list/create).' },
      name: { type: 'string', description: 'Nombre (create/update).' },
      description: { type: 'string' },
      professional: { type: 'string', description: 'Nombre o número del profesional (add/remove_professional).' },
      phone: { type: 'string', description: 'Número del cliente (share_with_client).' },
      client_name: { type: 'string' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  async run(args, me, ctx) {
    if (!ctx.isAdmin) return 'Solo el administrador gestiona las agendas generales.';
    switch (args.action) {
      case 'list': {
        const groups = schedRepo.listGroups();
        if (!groups.length) return 'No hay agendas generales todavía.';
        return groups
          .map((g) => {
            const members = (g.member_ids ?? '').split(',').filter(Boolean).map((id) => schedRepo.getProfessional(Number(id))?.display_name ?? `#${id}`);
            return `#${g.id} ${g.name}: ${members.join(', ') || '(sin profesionales)'} - ${schedRepo.clientsOfGroup(g.id).length} cliente(s)`;
          })
          .join('\n');
      }
      case 'create': {
        const name = strOrNull(args.name);
        if (!name) return 'Me falta el nombre del grupo.';
        if (schedRepo.getGroup(name)) return `Ya existe un grupo llamado "${name}".`;
        const id = schedRepo.createGroup(name.slice(0, 80), strOrNull(args.description) ?? '');
        return `Listo, creé la agenda general #${id} "${name}". Agrega profesionales con add_professional.`;
      }
      case 'update': {
        const g = resolveGroup(args.group);
        schedRepo.updateGroup(g.id, strOrNull(args.name) ?? g.name, args.description !== undefined ? String(args.description) : g.description);
        return 'Listo, actualicé el grupo.';
      }
      case 'delete': {
        const g = resolveGroup(args.group);
        schedRepo.deleteGroup(g.id);
        return `Listo, borré el grupo "${g.name}" (los clientes que tenían acceso solo por ese grupo lo pierden; las citas existentes siguen).`;
      }
      case 'add_professional':
      case 'remove_professional': {
        const g = resolveGroup(args.group);
        const prof = resolveProfessional(args.professional);
        const ids = new Set(schedRepo.groupMemberIds(g.id));
        if (args.action === 'add_professional') ids.add(prof.user_id);
        else ids.delete(prof.user_id);
        schedRepo.setGroupMembers(g.id, [...ids]);
        return `Listo, ${professionalLabel(prof)} ${args.action === 'add_professional' ? 'ahora está en' : 'ya no está en'} "${g.name}".`;
      }
      case 'share_with_client': {
        const g = resolveGroup(args.group);
        const r = await shareAccess(me, { groupId: g.id }, String(args.phone ?? ''), strOrNull(args.client_name));
        const who = r.client.name ?? r.client.jid.split('@')[0];
        return r.notified
          ? `Listo, ${who} ya puede agendar con cualquier profesional de "${g.name}" y le escribí.`
          : `Listo, ${who} ya tiene acceso a "${g.name}", pero no pude escribirle ahora. Reenvíale: "${r.forwardText}"`;
      }
      default:
        return 'Acción no válida.';
    }
  },
});
