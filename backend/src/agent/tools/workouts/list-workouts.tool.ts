import type { Tool } from '../../tool-registry.js';
import { exercisesModel } from '../../../models/exercises.model.js';
import { listWorkouts } from '../../../services/workouts/workouts.service.js';
import { workoutsView } from '../../views.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';

export const listWorkoutsTool: Tool = {
  name: 'list_workouts',
  description:
    'Muestra EJERCICIOS: boxeo, zumba, gym… con días, hora, lugar, cómo va la semana (sesiones y minutos) y la racha. Úsala ' +
    'para "mis ejercicios", "qué ejercicio tengo", "cuánto ejercicio llevo esta semana". Devuelve la lista ya diseñada: envíala TAL CUAL.',
  parameters: {
    type: 'object',
    properties: { target_user: { type: 'string', description: 'Solo administrador: otra persona con acceso.' } },
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    return workoutsView(listWorkouts(acting.userId), (id) => exercisesModel.listByRoutine(acting.userId, id));
  },
};
