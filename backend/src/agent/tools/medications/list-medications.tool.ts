import type { Tool } from '../../tool-registry.js';
import { medicationsModel } from '../../../models/medications.model.js';
import { medicationsView } from '../../views.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';

export const listMedicationsTool: Tool = {
  name: 'list_medications',
  description: 'Muestra Medicamentos y belleza: qué tomo o me aplico, a qué horas, dosis y cómo voy esta semana. Úsala para "qué medicamentos tengo".',
  parameters: {
    type: 'object',
    properties: {
      include_paused: { type: 'boolean', description: 'Incluir los pausados o terminados.' },
      target_user: { type: 'string', description: 'Solo administrador: otra persona con acceso.' },
    },
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    return medicationsView(medicationsModel.list(acting.userId, { includeInactive: args.include_paused === true }));
  },
};
