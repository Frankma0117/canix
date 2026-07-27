import type { Tool } from '../tool-registry.js';
import { rewardsRepo } from '../../db/repositories/rewards.repo.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';
import { todayLocal } from '../../util/datetime.js';
import type { RewardPunishmentType } from '../../types/index.js';

export const registerRewardPunishmentTool: Tool = {
  name: 'register_reward_punishment',
  description:
    'Registra un premio o castigo que me pongo a mí mismo, normalmente ligado al cumplimiento (o no) de una ' +
    'rutina/hábito (ej. "si cumplo la semana de ejercicio me premio con salir a comer", "si fallo 3 días seguidos me castigo sin videojuegos").',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['reward', 'punishment'], description: '"reward" (premio) o "punishment" (castigo).' },
      description: { type: 'string', description: 'En qué consiste el premio/castigo.' },
      routine: { type: 'string', description: 'Nombre de la rutina/hábito ligado, si aplica (ver list_todos con scope routine).' },
      note: { type: 'string', description: 'Nota opcional (ej. motivo puntual).' },
      date: { type: 'string', description: "Fecha 'YYYY-MM-DD' (default: hoy)." },
    },
    required: ['type', 'description'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const type: RewardPunishmentType = args.type === 'punishment' ? 'punishment' : 'reward';
    const description = String(args.description ?? '').trim();
    if (!description) return 'Error: falta la descripción.';

    let todoId: number | null = null;
    if (args.routine) {
      const matches = todosRepo.findByTitle(ctx.userId, String(args.routine), 'routine');
      if (matches.length > 1) return `Hay varias rutinas que coinciden con "${args.routine}", sé más específico.`;
      if (matches.length === 1) todoId = matches[0].id;
      // 0 matches: register it anyway, unlinked - still worth keeping the entry.
    }

    const date = args.date ? String(args.date) : todayLocal();
    const id = rewardsRepo.create(ctx.userId, {
      todoId,
      type,
      description,
      note: args.note ? String(args.note) : null,
      date,
    });

    const label = type === 'reward' ? 'Premio 🏆' : 'Castigo ⚠️';
    return `${label} #${id} registrado: "${description}"${todoId ? ' (ligado a la rutina)' : ''}.`;
  },
};
