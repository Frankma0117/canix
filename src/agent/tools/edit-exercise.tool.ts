import type { Tool } from '../tool-registry.js';
import { exercisesRepo } from '../../db/repositories/exercises.repo.js';

export const editExerciseTool: Tool = {
  name: 'edit_exercise',
  description: 'Edita un ejercicio ya registrado (series, repeticiones, segundos o peso) por su id.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id del ejercicio (ver list_exercises).' },
      name: { type: 'string', description: 'Nuevo nombre (opcional).' },
      sets: { type: 'number', description: 'Nuevas series (opcional).' },
      reps: { type: 'number', description: 'Nuevas repeticiones (opcional).' },
      seconds: { type: 'number', description: 'Nueva duración en segundos (opcional).' },
      weight_kg: { type: 'number', description: 'Nuevo peso en kg (opcional).' },
    },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const id = Number(args.id);
    const exercise = exercisesRepo.getById(ctx.userId, id);
    if (!exercise) return `No encontré el ejercicio #${id}.`;

    exercisesRepo.update(ctx.userId, id, {
      name: args.name !== undefined ? String(args.name) : undefined,
      sets: args.sets !== undefined ? Number(args.sets) : undefined,
      reps: args.reps !== undefined ? Number(args.reps) : undefined,
      seconds: args.seconds !== undefined ? Number(args.seconds) : undefined,
      weightKg: args.weight_kg !== undefined ? Number(args.weight_kg) : undefined,
    });

    return `Listo, actualicé el ejercicio #${id} 💪`;
  },
};
