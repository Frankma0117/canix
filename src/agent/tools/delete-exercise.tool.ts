import type { Tool } from '../tool-registry.js';
import { exercisesRepo } from '../../db/repositories/exercises.repo.js';

export const deleteExerciseTool: Tool = {
  name: 'delete_exercise',
  description: 'Elimina un ejercicio de una rutina por su id.',
  parameters: {
    type: 'object',
    properties: { id: { type: 'number', description: 'Id del ejercicio (ver list_exercises).' } },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const id = Number(args.id);
    const exercise = exercisesRepo.getById(ctx.userId, id);
    if (!exercise) return `No encontré el ejercicio #${id}.`;
    exercisesRepo.remove(ctx.userId, id);
    return `Listo, borré el ejercicio #${id} "${exercise.name}".`;
  },
};
