import type { Tool } from '../tool-registry.js';
import { exercisesRepo } from '../../db/repositories/exercises.repo.js';
import { resolveRoutine } from './resolve-routine.js';

export const addExerciseTool: Tool = {
  name: 'add_exercise',
  description:
    'Agrega un ejercicio (con series/repeticiones, o duración en segundos, y peso opcional) a una rutina ya creada ' +
    '(ver create_routine). Ej. "sentadillas, 4 series de 12 repeticiones" o "plancha, 3 series de 30 segundos".',
  parameters: {
    type: 'object',
    properties: {
      routine: { type: 'string', description: 'Nombre de la rutina a la que pertenece.' },
      name: { type: 'string', description: 'Nombre del ejercicio (ej. "sentadillas").' },
      sets: { type: 'number', description: 'Número de series.' },
      reps: { type: 'number', description: 'Repeticiones por serie (usa esto O seconds, no ambos normalmente).' },
      seconds: { type: 'number', description: 'Duración en segundos por serie, para ejercicios de tiempo (ej. plancha).' },
      weight_kg: { type: 'number', description: 'Peso usado en kg (opcional).' },
    },
    required: ['routine', 'name'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const resolved = resolveRoutine(ctx.userId, String(args.routine ?? ''));
    if (resolved.error) return resolved.error;

    const name = String(args.name ?? '').trim();
    if (!name) return 'Error: falta el nombre del ejercicio.';

    const id = exercisesRepo.create(ctx.userId, {
      todoId: resolved.todo!.id,
      name,
      sets: args.sets !== undefined ? Number(args.sets) : null,
      reps: args.reps !== undefined ? Number(args.reps) : null,
      seconds: args.seconds !== undefined ? Number(args.seconds) : null,
      weightKg: args.weight_kg !== undefined ? Number(args.weight_kg) : null,
    });

    return `Ejercicio #${id} "${name}" agregado a la rutina "${resolved.todo!.title}".`;
  },
};
