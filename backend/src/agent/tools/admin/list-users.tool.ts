import type { Tool } from '../../tool-registry.js';
import { usersModel } from '../../../models/users.model.js';
import { permissionsModel } from '../../../models/permissions.model.js';
import { describeIdentity } from '../../../shared/utils/jid.js';

export const listUsersTool: Tool = {
  name: 'list_users',
  description: 'Lista quién tiene acceso al bot y con qué paquetes (solo el administrador). Detalle de uno: get_user_permissions.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },

  async execute(_args, ctx) {
    if (!ctx.isAdmin) return 'Solo el administrador puede ver esta lista.';
    const users = usersModel.listAll();
    if (users.length === 0) return 'Todavía no le diste acceso a nadie.';
    return users
      .map((u) => {
        let access = ' — administrador';
        if (u.role !== 'admin') {
          const pkgs = permissionsModel.userPackages(u.id).map((p) => p.name);
          const overrides = permissionsModel.userOverrides(u.id);
          access = ` — ${pkgs.length ? pkgs.join(', ') : 'sin paquetes'}${overrides.length ? ` (+${overrides.length} ajuste(s) sueltos)` : ''}`;
        }
        const usernameNote = u.username ? ` @${u.username}` : '';
        const pausedNote = u.paused_until ? ` — 🔕 pausado hasta ${u.paused_until.slice(0, 10)}` : '';
        return `⟦${u.id}⟧ ${u.name ?? '(sin nombre)'}${usernameNote} (${describeIdentity(u.jid).label})${access}${pausedNote}`;
      })
      .join('\n');
  },
};
