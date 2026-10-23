import type { Tool } from '../../tool-registry.js';
import { medicationsModel } from '../../../models/medications.model.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';
import { resolveMedication } from './shared.js';

export const deleteMedicationTool: Tool = {
  name: 'delete_medication',
  description: 'Borra un medicamento/vitamina/crema de Medicamentos y belleza, con sus avisos e historial. Para dejarlo de tomar un tiempo, mejor edit_medication con active=false.',
  parameters: {
    type: 'object',
    properties: {
      medication: { type: 'string', description: 'Nombre (o marca ⟦id⟧).' },
      target_user: { type: 'string', description: 'Solo administrador: otra persona con acceso.' },
    },
    required: ['medication'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const med = resolveMedication(acting.userId, String(args.medication ?? ''));
    if ('error' in med) return med.error;
    medicationsModel.remove(acting.userId, med.id);
    return `Listo, borré "${med.name}" y sus avisos.`;
  },
};
