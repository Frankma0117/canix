import type { Tool } from '../../tool-registry.js';
import { createMedication, isMedicationKind, timesEvery, describeMedication, waterProgressLine } from '../../../services/medications/medications.service.js';
import { normalizeTimes } from '../../../shared/utils/clock-times.js';
import { addDays, normalizeDate, todayLocal } from '../../../shared/utils/datetime.js';
import { internalRef } from '../../../shared/utils/wa-format.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';
import { parseWeekdays } from './shared.js';

export const addMedicationTool: Tool = {
  name: 'add_medication',
  description:
    'Agrega a Medicamentos y belleza algo que se toma o se aplica a horas fijas: medicamentos, vitaminas, suplementos, ' +
    'cremas, skincare y TOMAR AGUA (kind water). A cada hora le aviso "toca tomar…" y se confirma con 👍/👎. Ej: "la pastilla ' +
    'de la tensión todos los días a las 8am", "el antibiótico cada 8 horas por 7 días desde las 6am", "crema de noche a las ' +
    '10pm", "mascarilla los domingos a las 7pm", "recuérdame tomar agua cada 2 horas de 8am a 8pm" (kind water, name "Agua", ' +
    'every_hours 2, first_time 08:00, until 20:00, dose "1 vaso"). Cuidado corporal (kind bodycare) con el nombre de la ' +
    'acción: "ponerme la faja a las 7am y quitármela a las 7pm" = DOS llamadas, name "Ponerme la faja" (07:00) y "Quitarme ' +
    'la faja" (19:00); "ponerme la faja cada 3 horas" = una con every_hours. Si ya tiene Agua, usa edit_medication. NO uses ' +
    'schedule_reminder ni schedule_interval_reminder para esto.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Qué es ("Losartán", "Vitamina D", "Crema de noche"), o la acción en cuidado corporal ("Ponerme la faja", "Quitarme la faja").' },
      kind: { type: 'string', enum: ['medicine', 'vitamin', 'supplement', 'cream', 'skincare', 'water', 'bodycare', 'other'], description: 'Tipo (water = tomar agua; bodycare = faja, medias de compresión, retenedor y otro cuidado corporal).' },
      times: { type: 'array', items: { type: 'string' }, description: "Horas 'HH:mm' de cada toma (ej. ['08:00','20:00'])." },
      every_hours: { type: 'number', description: 'En vez de times: cada cuántas horas (con first_time).' },
      first_time: { type: 'string', description: "Primera toma 'HH:mm' cuando usas every_hours." },
      until: { type: 'string', description: "Con every_hours: última hora del día 'HH:mm' (ej. agua de 8am a 8pm -> '20:00'). Sin until da la vuelta al reloj (para medicamentos cada 8 h)." },
      dose: { type: 'string', description: 'Dosis ("1 tableta", "500 mg", "2 gotas").' },
      instructions: { type: 'string', description: 'Indicaciones ("con el desayuno", "en ayunas").' },
      weekdays: { type: 'array', items: { type: 'string' }, description: 'Solo ciertos días ("lunes", "jueves"); vacío = todos los días.' },
      days: { type: 'number', description: 'Duración del tratamiento en días (ej. 7). Vacío = sin fin.' },
      start_date: { type: 'string', description: "Desde cuándo 'YYYY-MM-DD' (por defecto hoy)." },
      notes: { type: 'string', description: 'Notas (quién lo recetó, para qué es).' },
      target_user: { type: 'string', description: 'Solo administrador: otra persona con acceso.' },
    },
    required: ['name'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const name = String(args.name ?? '').trim();
    if (!name) return 'Me falta el nombre.';
    const times = Number(args.every_hours) > 0 ? timesEvery(Number(args.every_hours), String(args.first_time ?? '08:00'), args.until ? String(args.until) : undefined) : normalizeTimes(args.times);
    if (times.length === 0) return '¿A qué hora(s) te aviso? Necesito al menos una hora (ej. 8:00).';
    const startDate = args.start_date ? normalizeDate(String(args.start_date)).slice(0, 10) : todayLocal();
    const days = Number(args.days);
    const endDate = days > 0 ? addDays(startDate, Math.round(days) - 1).slice(0, 10) : null;

    const kind = isMedicationKind(args.kind) ? args.kind : 'medicine';
    const med = createMedication(acting.userId, {
      name,
      kind,
      times,
      dose: args.dose ? String(args.dose).trim() : null,
      instructions: args.instructions ? String(args.instructions).trim() : null,
      weekdays: parseWeekdays(args.weekdays),
      startDate,
      endDate,
      notes: args.notes ? String(args.notes).trim() : null,
    });
    if (kind === 'water') return `Listo 💧 te aviso tomar agua a las ${times.join(', ')} ${internalRef(med.id)}: tu meta es ${times.length} vasos al día. Reacciona 👍 a cada aviso (o dime "ya me tomé un vaso") y llevo la cuenta. ${waterProgressLine(med)}.`;
    return `Listo, agregué ${describeMedication(med)} ${internalRef(med.id)} - te aviso a las ${times.join(', ')}${med.weekdays ? ' (solo esos días)' : ''}${endDate ? ` hasta el ${endDate}` : ''}.`;
  },
};
