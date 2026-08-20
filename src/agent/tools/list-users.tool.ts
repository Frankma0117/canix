import type { Tool } from '../tool-registry.js';
import { usersRepo } from '../../db/repositories/users.repo.js';

export const listUsersTool: Tool = {
  name: 'list_users',
  description: 'Lista quién tiene acceso al bot (solo el administrador).',
  parameters: { type: 'object', properties: {}, additionalProperties: false },

  async execute(_args, ctx) {
    if (!ctx.isAdmin) return 'Solo el administrador puede ver esta lista.';
    const users = usersRepo.listAll();
    if (users.length === 0) return 'Todavía no le diste acceso a nadie.';
    return users
      .map((u) => {
        const allowed = usersRepo.getAllowedTools(u);
        const restriction = u.role === 'admin' ? ' — administrador' : allowed ? ` — restringido a: ${allowed.join(', ')}` : '';
        const usernameNote = u.username ? ` @${u.username}` : '';
        const pausedNote = u.paused_until ? ` — 🔕 pausado hasta ${u.paused_until.slice(0, 10)}` : '';
        return `#${u.id} ${u.name ?? '(sin nombre)'}${usernameNote} (${u.jid})${restriction}${pausedNote}`;
      })
      .join('\n');
  },
};
