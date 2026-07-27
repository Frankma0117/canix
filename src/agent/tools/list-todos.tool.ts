import type { Tool } from '../tool-registry.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import type { TodoScope, TodoStatus } from '../../types/index.js';

export const listTodosTool: Tool = {
  name: 'list_todos',
  description:
    'Lista tareas pendientes (o hechas), filtrando por scope ("today", "later", "routine"), categoría y/o estado.',
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['today', 'later', 'routine'] },
      status: { type: 'string', enum: ['pending', 'done', 'skipped'], description: 'Default: pending.' },
      category: { type: 'string', description: 'Nombre de categoría para filtrar (opcional).' },
    },
    additionalProperties: false,
  },

  async execute(args) {
    let categoryId: number | undefined;
    if (args.category) {
      const category = categoriesRepo.getByName(String(args.category));
      if (!category) return `No existe la categoría "${args.category}".`;
      categoryId = category.id;
    }

    const todos = todosRepo.list({
      scope: args.scope as TodoScope | undefined,
      status: (args.status as TodoStatus | undefined) ?? 'pending',
      categoryId,
    });

    if (todos.length === 0) return 'No hay tareas que coincidan.';
    return todos
      .map((t) => `#${t.id} ${t.title}${t.due_date ? ` (${t.due_date})` : ''} [${t.scope}]`)
      .join('\n');
  },
};
