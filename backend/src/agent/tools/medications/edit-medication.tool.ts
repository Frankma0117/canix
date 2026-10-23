import type { Tool } from '../../tool-registry.js';
import { describeMedication, isMedicationKind, timesEvery, updateMedication } from '../../../services/medications/medications.service.js';
import { normalizeTimes } from '../../../shared/utils/clock-times.js';
import { normalizeDate } from '../../../shared/utils/datetime.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';
import { parseWeekdays, resolveMedication } from './shared.js';

export const editMedicationTool: Tool = {
  name: 'edit_medication',
  description:
    'Cambia algo de un medicamento/vitamina/crema de Medicamentos y belleza: horas, dosis, indicaciones, días, fin del ' +
    'tratamiento, nombre; o lo pausa (active=false) / reanuda (active=true). También el Agua ("avísame agua cada hora", ' +
    '"pausa lo del agua") y el cuidado corporal ("la faja ahora a las 8"). Identifícalo por su nombre.',
  parameters: {
    type: 'object',
    properties: {
      medication: { type: 'string', description: 'Nombre (o marca ⟦id⟧).' },
      name: { type: 'string' },
      kind: { type: 'string', enum: ['medicine', 'vitamin', 'supplement', 'cream', 'skincare', 'water', 'bodycare', 'other'] },
      times: { type: 'array', items: { type: 'string' }, description: "Nuevas horas 'HH:mm' (reemplazan las anteriores)." },
      every_hours: { type: 'number' },
      first_time: { type: 'string' },
      until: { type: 'string', description: "Con every_hours: última hora del día 'HH:mm'." },
      dose: { type: 'string' },
      instructions: { type: 'string' },
      weekdays: { type: 'array', items: { type: 'string' }, description: 'Días; vacío = todos.' },
      end_date: { type: 'string', description: "Último día 'YYYY-MM-DD'; 'none' para quitarlo." },
      notes: { type: 'string' },
      active: { type: 'boolean', description: 'false = pausar (sin avisos), true = reanudar.' },
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
    const times = Number(args.every_hours) > 0 ? timesEvery(Number(args.every_hours), String(args.first_time ?? '08:00'), args.until ? String(args.until) : undefined) : args.times !== undefined ? normalizeTimes(args.times) : undefined;
    if (times && times.length === 0) return 'Esas horas no son válidas (usa HH:mm).';
    const text = (v: unknown) => (v === undefined ? undefined : String(v).trim() || null);
    const updated = updateMedication(acting.userId, med.id, {
      name: args.name ? String(args.name).trim() : undefined,
      kind: isMedicationKind(args.kind) ? args.kind : undefined,
      times,
      dose: text(args.dose),
      instructions: text(args.instructions),
      weekdays: args.weekdays === undefined ? undefined : parseWeekdays(args.weekdays),
      endDate: args.end_date === undefined ? undefined : String(args.end_date) === 'none' ? null : normalizeDate(String(args.end_date)).slice(0, 10),
      notes: text(args.notes),
      active: typeof args.active === 'boolean' ? args.active : undefined,
    })!;
    const state = updated.active ? '' : ' (pausado: no te aviso hasta que lo reanudes)';
    return `Listo, actualicé ${describeMedication(updated)}${state}.`;
  },
};
