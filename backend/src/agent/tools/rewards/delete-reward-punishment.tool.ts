import type { Tool } from '../../tool-registry.js';
import { rewardsModel } from '../../../models/rewards.model.js';

export const deleteRewardPunishmentTool: Tool = {
  name: 'delete_reward_punishment',
  description: 'Elimina un premio o castigo registrado, por su id (ver list_rewards_punishments).',
  parameters: {
    type: 'object',
    properties: { id: { type: 'number', description: 'Id del registro a eliminar.' } },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const id = Number(args.id);
    const item = rewardsModel.getById(ctx.userId, id);
    if (!item) return `No encontré el registro ⟦${id}⟧.`;
    rewardsModel.remove(ctx.userId, id);
    return `Listo, borré el ${item.type === 'reward' ? 'premio' : 'castigo'} "${item.description}".`;
  },
};
