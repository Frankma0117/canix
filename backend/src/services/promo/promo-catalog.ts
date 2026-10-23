import type { ChatLine } from '../../entities/promo.entity.js';

/**
 * What the advertising material can talk about: the real features of Canix (the same ones the
 * public site sells - frontend/landing/index.html), each with the facts the script writer may use,
 * the mascot sticker that fits it and an example chat for the fixed templates. Never add a promise
 * here that the product doesn't keep: the model only repeats these facts.
 */
export interface PromoFeature {
  key: string;
  name: string;
  emoji: string;
  sticker: string;
  facts: string;
  chat: ChatLine[];
}

const me = (text: string, voice = false): ChatLine => ({ from: 'me', text, ...(voice ? { voice } : {}) });
const canix = (text: string): ChatLine => ({ from: 'canix', text });

export const FEATURES: PromoFeature[] = [
  {
    key: 'reminders', name: 'Recordatorios', emoji: '⏰', sticker: 'agendado',
    facts: 'Recordatorios puntuales ("en 20 minutos"), recurrentes (cada día, semana, mes o año), flexibles en una franja horaria y por intervalos. Se pausan, editan o cancelan con una frase. Se confirman con 👍 / 👎.',
    chat: [me('Recuérdame pagar el arriendo el 5 de cada mes'), canix('¡Listo! 📅 Te aviso el 5 de cada mes a las 9:00 a. m. para pagar el arriendo.')],
  },
  {
    key: 'dates', name: 'Fechas importantes', emoji: '🎂', sticker: 'evento',
    facts: 'Cumpleaños, aniversarios, pagos o vencimientos con aviso previo días antes.',
    chat: [me('El cumpleaños de mi mamá es el 12 de marzo, avísame 3 días antes'), canix('Anotado 🎂 El 9 de marzo te recuerdo el cumpleaños de tu mamá.')],
  },
  {
    key: 'routines', name: 'Rutinas y hábitos', emoji: '🔥', sticker: 'rutina',
    facts: 'Rutinas con hora fija y días de la semana, un aviso a su hora, rachas, progreso semanal, ejercicios por rutina, premios y castigos.',
    chat: [me('Crea una rutina de cardio lunes y jueves a las 6am, 40 minutos'), canix('💪 Rutina creada: cardio lunes y jueves a las 6:00 a. m. ¡Vamos por esa racha!')],
  },
  {
    key: 'todos', name: 'Tareas y listas', emoji: '✅', sticker: 'tareas',
    facts: 'Pendientes de hoy, cosas para después y listas para ir marcando (mercado, películas, ideas).',
    chat: [me('Agrega leche, huevos y café a la lista del mercado'), canix('🛒 Listo, tu lista del mercado tiene 4 cosas: leche, huevos, café y pan.')],
  },
  {
    key: 'agenda', name: 'Agenda del día', emoji: '☀️', sticker: 'listo',
    facts: 'Al preguntar "¿qué tengo hoy?" responde todo ordenado por hora; cada semana manda un resumen de lo logrado.',
    chat: [me('¿Qué tengo hoy?'), canix('☀️ Hoy: leer 20 min (racha de 6 días 🔥), pagar el internet y la lista del mercado (4 cosas pendientes).')],
  },
  {
    key: 'notes', name: 'Notas y links', emoji: '📝', sticker: 'nota',
    facts: 'Guarda información importante y la busca después; organiza links por categorías.',
    chat: [me('Anota que el aceite del carro es 5W-30'), canix('📝 Guardado en tus notas: aceite del carro 5W-30.')],
  },
  {
    key: 'voice', name: 'Notas de voz', emoji: '🎤', sticker: 'mensaje',
    facts: 'Entiende notas de voz y puede responder con audio; con el extra de voz natural suena humana, voz de hombre o de mujer.',
    chat: [me('Recuérdame la cita con el odontólogo el jueves a las 3pm', true), canix('¡Listo! 📅 Te aviso el jueves a las 3:00 p. m.')],
  },
  {
    key: 'calls', name: 'Llamadas de recordatorio', emoji: '📞', sticker: 'llamada',
    facts: 'Para lo que no se puede olvidar, Canix llama por teléfono de verdad como recordatorio o como alarma para despertar (extra opcional).',
    chat: [me('Llámame mañana a las 6 para despertarme'), canix('☎️ Hecho: mañana a las 6:00 a. m. te llamo para despertarte.')],
  },
  {
    key: 'contacts', name: 'Mensajes a tus contactos', emoji: '💬', sticker: 'mensaje',
    facts: 'Guarda contactos y les escribe por la persona: "dile a Ana que llego en 10 minutos".',
    chat: [me('Dile a Ana que llego en 10 minutos'), canix('📨 Le escribí a Ana: "Llego en 10 minutos".')],
  },
  {
    key: 'meals', name: 'Comidas y recetas', emoji: '🍽️', sticker: 'listo',
    facts: 'Planea desayuno, almuerzo, onces y cena de la semana y guarda recetas con ingredientes y preparación.',
    chat: [me('¿Qué puedo cocinar con pollo y arroz?'), canix('🍗 Tienes guardado "Arroz con pollo": 40 minutos. ¿Te paso la preparación?')],
  },
  {
    key: 'fashion', name: 'Modo Fashion', emoji: '👕', sticker: 'enfoque',
    facts: 'Armario digital con fotos de las prendas y recomendaciones de outfits para cada ocasión.',
    chat: [me('Un outfit para una cena informal'), canix('👕 Te armé uno: camisa azul, jean oscuro y tenis blancos. ¿Te gusta?')],
  },
  {
    key: 'scheduling', name: 'Agenda de citas para profesionales', emoji: '🗓️', sticker: 'evento',
    facts: 'Para psicólogos, médicos, coaches, entrenadores o estéticas: define horarios, los clientes piden citas por WhatsApp, el profesional confirma y ambos reciben recordatorios. Calendario web.',
    chat: [me('Quiero una cita con la psicóloga el martes en la tarde'), canix('🗓️ Hay espacio el martes a las 3:00 p. m. o a las 4:30 p. m. ¿Cuál prefieres?')],
  },
  {
    key: 'portal', name: 'Portal web', emoji: '💻', sticker: 'control',
    facts: 'Portal web con número y contraseña para ver recordatorios, rutinas, tareas, notas, links, comidas y citas en un solo lugar; permisos por persona para familias y equipos.',
    chat: [me('¿Dónde veo todo lo que tengo guardado?'), canix('💻 En tu portal web: entra con tu número y contraseña y lo ves todo en un solo lugar.')],
  },
];

export const FEATURE_KEYS = FEATURES.map((f) => f.key);
export const featureByKey = (key: string | null | undefined) => FEATURES.find((f) => f.key === key);

/** What every script can rely on about the product as a whole. */
export const PRODUCT_FACTS =
  'Canix es un asistente personal con IA que vive dentro de WhatsApp: no hay que instalar nada. Se le escribe o se le manda ' +
  'un audio como a un amigo. Recuerda lo importante, sostiene rutinas, organiza tareas, guarda notas y agenda citas de ' +
  'clientes. Entiende fechas, horas y repeticiones; si le falta un dato pregunta en vez de inventar. Funciona 24/7, en ' +
  'WhatsApp y en un portal web. Hecho para Latinoamérica, habla español natural y usa la hora de Colombia. Cada persona ' +
  'tiene su espacio privado. Hay demo gratis por unas horas, sin tarjeta; los planes (personal, profesional, familias y ' +
  'equipos) se arman por WhatsApp.';

export const VIDEO_FORMATS = ['landscape', 'vertical'] as const;
export const IMAGE_FORMATS = ['square', 'story', 'landscape'] as const;
export const IMAGE_LAYOUTS = ['chat', 'features', 'mascot'] as const;
export const KINDS = ['ad', 'howto', 'feature'] as const;

/** Background music generated once with fal.ai (CassetteAI) and reused by every video. */
export const MUSIC: { key: string; name: string; prompt: string }[] = [
  { key: 'moderna', name: 'Moderna y alegre', prompt: 'upbeat modern pop background music for a tech app ad, soft synths, light claps, positive and friendly, no vocals, seamless loop' },
  { key: 'tranquila', name: 'Tranquila', prompt: 'calm lo-fi background music for a productivity app ad, mellow keys, soft beat, warm, no vocals, seamless loop' },
  { key: 'energica', name: 'Enérgica', prompt: 'energetic motivating electronic background music for a short social media ad, punchy drums, bright synth, no vocals, seamless loop' },
];
