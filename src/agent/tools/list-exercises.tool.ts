import type { Tool } from '../tool-registry.js';
import { exercisesRepo } from '../../db/repositories/exercises.repo.js';
import { resolveRoutine } from './resolve-routine.js';

function fmt(e: { id: number; name: string; sets: number | null; reps: number | null; seconds: number | null; weight_kg: number | null }): string {
  const parts: string[] = [];
  if (e.sets) parts.push(`${e.sets} series`);
  if (e.reps) parts.push(`${e.reps} rep`);
  if (e.seconds) parts.push(`${e.seconds}s`);
  if (e.weight_kg) parts.push(`${e.weight_kg}kg`);
  return `#${e.id} ${e.name}${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

export const listExercisesTool: Tool = {
  name: 'list_exercises',
  description: 'Lista los ejercicios de una rutina (series, repeticiones, duración, peso).',
  parameters: {
    type: 'object',
    properties: { routine: { type: 'string', description: 'Nombre de la rutina.' } },
    required: ['routine'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const resolved = resolveRoutine(ctx.userId, String(args.routine ?? ''));
    if (resolved.error) return resolved.error;

    const exercises = exercisesRepo.listByRoutine(ctx.userId, resolved.todo!.id);
    if (exercises.length === 0) return `La rutina "${resolved.todo!.title}" todavía no tiene ejercicios registrados.`;
    return exercises.map(fmt).join('\n');
  },
};
