import { exercisesBlock } from '../../views.js';
import type { Tool } from '../../tool-registry.js';
import { exercisesModel } from '../../../models/exercises.model.js';
import { resolveRoutine } from '../shared/resolve-routine.js';

export const listExercisesTool: Tool = {
  name: 'list_exercises',
  description: 'Lista los ejercicios de una rutina (series, repeticiones, duración, peso). Devuelve la lista ya diseñada para WhatsApp: envíala TAL CUAL.',
  parameters: {
    type: 'object',
    properties: { routine: { type: 'string', description: 'Nombre de la rutina.' } },
    required: ['routine'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const resolved = resolveRoutine(ctx.userId, String(args.routine ?? ''));
    if (resolved.error) return resolved.error;

    const exercises = exercisesModel.listByRoutine(ctx.userId, resolved.todo!.id);
    if (exercises.length === 0) return `La rutina "${resolved.todo!.title}" todavía no tiene ejercicios registrados.`;
    return exercisesBlock(exercises, { title: `Ejercicios de ${resolved.todo!.title}`, withIds: true });
  },
};
