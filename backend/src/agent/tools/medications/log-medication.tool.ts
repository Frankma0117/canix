import type { Tool } from '../../tool-registry.js';
import { logMedicationAnswer, waterProgressLine } from '../../../services/medications/medications.service.js';
import { normalizeDate, todayLocal } from '../../../shared/utils/datetime.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';
import { resolveMedication } from './shared.js';

export const logMedicationTool: Tool = {
  name: 'log_medication',
  description:
    'Anota que me tomé (o no) un medicamento/vitamina/crema hoy u otro día, cuando lo digo en el chat ("ya me tomé la vitamina", ' +
    '"hoy no me puse la crema"). Para el agua cada llamada con taken=true es UN vaso ("ya me tomé un vaso de agua"; "me tomé 2 ' +
    'vasos" = dos llamadas).',
  parameters: {
    type: 'object',
    properties: {
      medication: { type: 'string', description: 'Nombre (o marca ⟦id⟧).' },
      taken: { type: 'boolean', description: 'true = sí, false = no.' },
      date: { type: 'string', description: "Día 'YYYY-MM-DD' (por defecto hoy)." },
      target_user: { type: 'string', description: 'Solo administrador: otra persona con acceso.' },
    },
    required: ['medication', 'taken'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const med = resolveMedication(acting.userId, String(args.medication ?? ''));
    if ('error' in med) return med.error;
    const date = args.date ? normalizeDate(String(args.date)).slice(0, 10) : todayLocal();
    logMedicationAnswer(acting.userId, med, date, args.taken !== false, 'chat');
    if (med.kind === 'water') return args.taken !== false ? `💧 Anotado un vaso. ${waterProgressLine(med, date)}.` : 'Anotado.';
    return args.taken !== false ? `Anotado: ${med.name} ✔️ (${date}).` : `Anotado: hoy no ${med.name} (${date}).`;
  },
};
