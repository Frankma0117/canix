/**
 * An emoji that says what a routine, reminder or task is about, picked from its own title - so a
 * day's list reads at a glance ("🚿 Ducha", "💊 Sertralina", "🥊 Boxeo") instead of as a wall of
 * text. Nothing is invented: it's only decoration on the person's own titles, and a title that
 * already brings an emoji keeps it as is.
 */
const RULES: [RegExp, string][] = [
  // health & body
  [/\bagua\b|\bhidrat/, '💧'], // not "aguacate"
  [/\b(faja|corset|medias de compresion|retenedor)/, '🩱'],
  [/\b(pastilla|medicament|medicina|sertralina|antibiotic|dosis|jarabe|gotas|inyecci|insulina|anticoncept)/, '💊'],
  [/\b(vitamina|suplement|creatina|proteina|colageno|omega)/, '💊'],
  [/\b(skincare|skin care|crema|protector solar|proteccion solar|bloqueador|mascarilla|serum|hidratante|exfoli|rutina facial)/, '🧴'],
  [/\b(ducha|ducharme|banar|banarme|bano)\b/, '🚿'],
  [/\b(dientes|cepill|hilo dental|enjuague)/, '🪥'],
  [/\b(cabello|pelo|peluquer|barber)/, '💇'],
  [/\b(unas|manicure|pedicure)\b/, '💅'],
  [/\bfaja\b/, '🎽'],
  [/\b(dormir|acostar|sueno|siesta|descansar)/, '😴'],
  [/\b(despertar|levantar|alarma)/, '⏰'],
  [/\b(medico|doctor|odontolog|dentista|terapia|psicolog|cita medica|examen|control)\b/, '🩺'],
  // movement
  [/\b(estir|yoga|pilates|movilidad|flexibilidad)/, '🧘'],
  [/\b(medit|respiraci|mindful)/, '🧘'],
  [/\b(boxeo|box|kick)/, '🥊'],
  [/\b(zumba|baile|bailar|danza)/, '💃'],
  [/\b(cardio|correr|trotar|trote|caminar|caminata|pasos)/, '🏃'],
  [/\b(bici|cicla|ciclismo|spinning)/, '🚴'],
  [/\b(nadar|natacion|piscina)/, '🏊'],
  [/\b(futbol|micro)\b/, '⚽'],
  [/\b(gym|gimnasio|pesas|fuerza|entren|ejercicio|pierna|pecho|espalda|abdomen|abdominales|gluteo|sentadilla|flexiones)/, '🏋️'],
  // food
  [/\b(desayun)/, '🍳'],
  [/\b(almuerz|almorz)/, '🍽️'],
  [/\b(cena|cenar|comida)\b/, '🍲'],
  [/\b(cocinar|receta|meal prep)/, '🍳'],
  [/\b(mercado|compras|supermercado|lista de compras)/, '🛒'],
  [/\b(cafe|tinto|onces|merienda|snack)\b/, '☕'],
  // mind & work
  [/\b(leer|lectura|libro)/, '📚'],
  [/\b(ingles|frances|aleman|portugues|idioma|duolingo)/, '🗣️'],
  [/\b(vim|consola|terminal|programar|codigo|codear|git|python|javascript)/, '💻'],
  [/\b(estudi|curso|clase|tarea|repasar|universidad|colegio|examen)/, '📖'],
  [/\b(escribir|diario|journal|bitacora)/, '✍️'],
  [/\b(reunion|meeting|junta|llamada de trabajo)/, '👥'],
  [/\b(trabajo|oficina|proyecto|informe|reporte|entrega)/, '💼'],
  [/\b(correo|email|mail)\b/, '📧'],
  [/\b(llamar|llamada|telefon)/, '📞'],
  [/\b(piano|guitarra|musica|cantar|instrumento)/, '🎵'],
  [/\b(orar|rezar|oracion|biblia|iglesia|misa)/, '🙏'],
  // home & errands
  [/\b(ropa|lavadora|planchar|outfit|vestir)/, '👕'],
  [/\b(aseo|limpi|barrer|trapear|ordenar|organizar|basura|loza|platos)/, '🧹'],
  [/\b(perro|pasear|gato|mascota|veterinari)/, '🐾'],
  [/\b(planta|regar|jardin)/, '🌱'],
  [/\b(pagar|pago|factura|recibo|banco|arriendo|cuota|tarjeta|transferencia)/, '💳'],
  [/\b(carro|moto|gasolina|tecnomecanica|soat|taller)/, '🚗'],
  [/\b(cumpleanos|cumple|aniversario)/, '🎂'],
  [/\b(viaje|vuelo|maleta|aeropuerto)/, '✈️'],
  [/\b(cita|agendar|turno)/, '📅'],
];

const HAS_EMOJI_RE = /\p{Extended_Pictographic}/u;

function plain(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** The emoji for a title, or `fallback` when nothing in it is recognized. */
export function iconFor(title: string, fallback = '🔹'): string {
  const t = plain(title);
  for (const [re, icon] of RULES) if (re.test(t)) return icon;
  return fallback;
}

/** "🚿 Ducha diaria" - the title with its emoji in front; a title that already has one stays as is. */
export function withIcon(rawTitle: string, fallback = '🔹'): string {
  // Shown with a capital first letter however it was typed ("tomar agua" -> "Tomar agua").
  const title = rawTitle.trim().replace(/^\p{Ll}/u, (c) => c.toUpperCase());
  return HAS_EMOJI_RE.test(title) ? title : `${iconFor(title, fallback)} ${title}`;
}
