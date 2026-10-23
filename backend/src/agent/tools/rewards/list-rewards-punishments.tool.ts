import type { Tool } from '../../tool-registry.js';
import { rewardsModel } from '../../../models/rewards.model.js';
import { todosModel } from '../../../models/todos.model.js';
import type { RewardPunishmentType } from '../../../entities/index.js';

export const listRewardsPunishmentsTool: Tool = {
  name: 'list_rewards_punishments',
  description: 'Lista mi historial de premios y castigos, opcionalmente filtrando por tipo o por rutina.',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['reward', 'punishment'], description: 'Filtra solo premios o solo castigos.' },
      routine: { type: 'string', description: 'Nombre de una rutina para ver solo los suyos.' },
    },
    additionalProperties: false,
  },

  async execute(args, ctx) {
    let items;
    if (args.routine) {
      const matches = todosModel.findByTitle(ctx.userId, String(args.routine), 'routine');
      if (matches.length === 0) return `No encontré ninguna rutina llamada "${args.routine}".`;
      if (matches.length > 1) return `Hay varias rutinas que coinciden con "${args.routine}", sé más específico.`;
      items = rewardsModel.listByTodo(ctx.userId, matches[0].id);
    } else {
      items = rewardsModel.listAll(ctx.userId, args.type as RewardPunishmentType | undefined);
    }

    if (items.length === 0) return 'Todavía no tienes premios ni castigos registrados.';
    return items
      .map((i) => `⟦${i.id}⟧ [${i.type === 'reward' ? '🏆' : '⚠️'}] ${i.date} — ${i.description}${i.note ? ` (${i.note})` : ''}`)
      .join('\n');
  },
};
