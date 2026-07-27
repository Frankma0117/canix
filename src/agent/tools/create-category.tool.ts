import type { Tool } from '../tool-registry.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';

export const createCategoryTool: Tool = {
  name: 'create_category',
  description:
    'Crea una nueva categoría para clasificar links, tareas o recordatorios. Úsala cuando pida una categoría que no existe todavía.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nombre de la categoría (ej. "Comidas", "Series").' },
      description: { type: 'string', description: 'Descripción corta opcional de para qué es.' },
    },
    required: ['name'],
    additionalProperties: false,
  },

  async execute(args) {
    const name = String(args.name ?? '').trim();
    if (!name) return 'Error: falta el nombre de la categoría.';
    const existing = categoriesRepo.getByName(name);
    if (existing) return `La categoría "${existing.name}" ya existía (#${existing.id}).`;
    const id = categoriesRepo.create(name, args.description ? String(args.description) : null);
    return `Categoría "${name}" creada (#${id}).`;
  },
};
