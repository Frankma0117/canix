/**
 * The moments a sticker can be sent for. The code detects most of them on its own (an action that
 * just succeeded, a greeting, a completed routine, the close of the day) and the agent can send
 * one for the rest; each sticker says which moments it fits (stickers.moments, set by the admin in
 * the portal). Until the admin sets them, they are suggested from the sticker's name by the stems
 * below - so a newly uploaded pack works right away and can be fine-tuned later.
 *
 * Keys are stored in the database: add new ones freely, never rename an existing one.
 */
export interface StickerMoment {
  key: string;
  label: string;
  /** When the code sends it on its own - shown in the portal next to the moment. */
  when: string;
  /** Name stems that suggest the moment (compared without accents, spaces or underscores). */
  stems: string[];
}

export const STICKER_MOMENTS: StickerMoment[] = [
  { key: 'greeting_morning', label: 'Saludo de la mañana', when: 'Cuando la persona saluda antes del mediodía.', stems: ['buenosdias', 'buendia', 'cafe', 'manana', 'despert', 'arranc'] },
  { key: 'greeting', label: 'Saludo', when: 'Cuando la persona saluda (hola, buenas, qué más).', stems: ['hola', 'saludo', 'holi', 'bienvenid', 'vamosalla', 'enquemaspuedo'] },
  { key: 'goodbye', label: 'Despedida', when: 'Cuando la persona se despide (chao, nos vemos).', stems: ['chao', 'adios', 'hastaluego', 'nosvemos', 'bye'] },
  { key: 'good_night', label: 'Buenas noches', when: 'Al cerrar el día (última tarea hecha) o cuando dice que se va a dormir.', stems: ['noche', 'dormir', 'dulcessuenos', 'goodnight', 'diaproductivo', 'descans'] },
  { key: 'thanks', label: 'Gracias', when: 'Cuando la persona agradece.', stems: ['gracias', 'confia', 'agradec', 'conmucho'] },
  { key: 'encouragement', label: 'Ánimo', when: 'Cuando la persona está cansada, estresada o desmotivada.', stems: ['tupuedes', 'animo', 'respira', 'fuerza', 'cadapieza', 'nopares', 'pacien', 'calma'] },
  { key: 'task_done', label: 'Tarea completada', when: 'Al marcar una tarea como hecha.', stems: ['tareacomplet', 'hecho', 'todolisto', 'listo', 'check', 'celebr', 'felicit', 'bienhecho', 'logr', 'exito', 'aplaus', 'bravo', 'genial'] },
  { key: 'routine_done', label: 'Rutina cumplida', when: 'Al marcar una rutina como cumplida.', stems: ['habitocomplet', 'rutinacomplet', 'constancia', 'racha', 'celebr', 'felicit', 'bienhecho', 'logr', 'campeon', 'trofeo', 'orgullo', 'excelente'] },
  { key: 'reminder_set', label: 'Recordatorio agendado', when: 'Al programar un recordatorio, fecha importante o alarma.', stems: ['agendad', 'planenmarcha', 'bajocontrol', 'alarma', 'recordatorio', 'reloj'] },
  { key: 'call_set', label: 'Llamada programada', when: 'Al programar o editar un recordatorio por llamada.', stems: ['llamada', 'telefono', 'ring'] },
  { key: 'updated', label: 'Cambio guardado', when: 'Al editar un recordatorio, rutina o tarea.', stems: ['actualiz', 'progreso', 'cambio', 'ajust'] },
  { key: 'message_sent', label: 'Mensaje enviado', when: 'Al enviar un mensaje a un contacto.', stems: ['mensaje', 'enviado', 'correo', 'carta'] },
  { key: 'idea_saved', label: 'Idea o nota guardada', when: 'Al guardar una nota, un link o algo en la biblioteca.', stems: ['nota', 'idea', 'apunt', 'buenaidea', 'libro', 'pelicula', 'musica'] },
  { key: 'list_updated', label: 'Lista o pendiente', when: 'Al crear una lista, agregarle cosas o crear una tarea.', stems: ['lista', 'tareas', 'compras', 'pendiente'] },
  { key: 'routine_created', label: 'Rutina creada', when: 'Al crear una rutina.', stems: ['rutina', 'constancia', 'meta', 'enfoc', 'vamosportus'] },
  { key: 'workout', label: 'Ejercicio', when: 'Al agregar ejercicios a una rutina.', stems: ['ejercicio', 'gym', 'pausaactiva', 'vamosalla', 'tupuedes', 'fuerza'] },
  { key: 'food', label: 'Comida o receta', when: 'Al planear una comida o guardar una receta.', stems: ['comida', 'receta', 'cocina', 'almuerzo', 'cena', 'desayuno'] },
  { key: 'contact_saved', label: 'Contacto guardado', when: 'Al guardar un contacto.', stems: ['contacto', 'amigo'] },
  { key: 'reward', label: 'Premio', when: 'Al registrar un premio o castigo.', stems: ['sorpresa', 'premio', 'regalo'] },
  { key: 'rest', label: 'Descanso', when: 'Al pausar los avisos.', stems: ['descanso', 'vacacion', 'relax'] },
  { key: 'agenda', label: 'Agenda del día', when: 'Al mostrar la agenda de un día.', stems: ['control', 'enfoque', 'agenda', 'plan'] },
  { key: 'weekly_report', label: 'Resumen semanal', when: 'Al mostrar el resumen de la semana.', stems: ['progreso', 'excelentetrabajo', 'vamosportus', 'semana'] },
  { key: 'appointment', label: 'Cita agendada', when: 'Al pedir, crear o confirmar una cita.', stems: ['reunion', 'evento', 'cita', 'agendad'] },
  { key: 'outfit', label: 'Outfit', when: 'Al guardar un outfit.', stems: ['outfit', 'look', 'moda', 'ropa', 'estilo'] },
];

export const MOMENT_KEYS = new Set(STICKER_MOMENTS.map((m) => m.key));

const squash = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Moments a sticker's name suggests, for stickers whose moments the admin hasn't set yet. */
export function suggestMoments(label: string | null): string[] {
  if (!label) return [];
  const name = squash(label);
  return STICKER_MOMENTS.filter((m) => m.stems.some((stem) => name.includes(stem))).map((m) => m.key);
}

/** Only known moment keys, de-duplicated. */
export function cleanMoments(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.map(String).filter((k) => MOMENT_KEYS.has(k)))] : [];
}
