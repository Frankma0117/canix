import type { Tool } from '../tool-registry.js';
import { rewardsRepo } from '../../db/repositories/rewards.repo.js';

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
    const item = rewardsRepo.getById(ctx.userId, id);
    if (!item) return `No encontré el registro #${id}.`;
    rewardsRepo.remove(ctx.userId, id);
    return `${item.type === 'reward' ? 'Premio' : 'Castigo'} "${item.description}" eliminado.`;
  },
};
