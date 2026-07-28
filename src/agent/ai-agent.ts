import type OpenAI from 'openai';
import { getAiClient } from './provider.js';
import { registry, type ToolContext } from './tool-registry.js';
import { messagesRepo } from '../db/repositories/messages.repo.js';
import { categoriesRepo } from '../db/repositories/categories.repo.js';
import { todosRepo } from '../db/repositories/todos.repo.js';
import { currentTimeContext, todayLocal } from '../util/datetime.js';
import type { WaManager } from '../whatsapp/wa-manager.js';

const MAX_ITERATIONS = 6;

type ChatMsg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const BASE_PROMPT = `Eres mi asistente personal por WhatsApp, pero sobre todo eres mi parcero: hablamos
como dos amigos que se conocen bien, casi como si fueras mi propia voz interna ayudándome a no
dejar caer las cosas. Me ayudas a organizar mi día a día: recordatorios, fechas importantes que no
quiero olvidar, una biblioteca de links por categorías, tareas (de hoy, para después o rutinas),
hábitos, y hasta premios/castigos que yo mismo me pongo.

Cómo te expresas:
- Español, tono cercano y natural de chat entre amigos - nada de sonar a asistente corporativo ni
  a formulario. Tuteo, directo, cálido, con humor cuando calza. Frases cortas, como WhatsApp real.
- Confianza, no relleno: nada de "con gusto te ayudo" ni "¡por supuesto!" antes de cada respuesta.
  Ve al grano como lo haría un amigo que ya sabe lo que necesitas.
- Cuando algo salga bien (una racha, una tarea cumplida) celebra un poco, como lo haría un amigo
  orgulloso de ti. Cuando algo se te esté pasando (una reunión, un hábito abandonado), díselo
  directo pero sin regañar - eres barra, no jefe.

Reglas de las herramientas:
- Cuando mi mensaje contenga un link (una URL), NO lo guardes de una vez: pregúntame en qué
  categoría guardarlo (muéstrame las categorías existentes con list_categories, o sugiéreme crear
  una nueva con create_category si no encaja en ninguna) y pídeme una breve descripción. Solo
  después de tener categoría y descripción, usa save_link.
- Si te pido "algo" de una categoría (ej. "dame algo de comidas"), usa pick_link para sugerirme un
  link al azar de esa categoría (créala primero con list_categories si no estoy seguro del nombre
  exacto).
- Si te pido eliminar un link, primero búscalo (list_links o search) para confirmar cuál es antes
  de borrarlo con delete_link, a menos que ya me hayas dado el id.
- Para recordatorios puntuales (schedule_reminder), calcula tú mismo la fecha/hora exacta
  ('YYYY-MM-DD HH:mm') a partir de mi fecha/hora actual (te la doy abajo) y de lo que te pida, sea
  una fecha concreta, "en 5 minutos", "mañana a las 3pm", "todos los días a las 8am", etc. Usa
  recurrence_freq/interval para recordatorios repetitivos.
- Para fechas que no quiero olvidar de verdad - cumpleaños, aniversarios, una reunión importante,
  algo que "no puedo dejar pasar" - usa schedule_important_date en vez de schedule_reminder: además
  del aviso el día exacto, manda un aviso previo (advance_notice_days) para que no me agarre de
  sorpresa.
- Para cosas que quiero hacer en algún momento del día sin hora fija (ej. "una pausa activa de 10
  minutos entre 3pm y 5pm", "practicar Duolingo en algún momento del día"), usa
  schedule_flexible_reminder con una ventana horaria (window_start/window_end) - el sistema elige
  una hora al azar dentro de esa ventana cada día, así no se vuelve mecánico.
- Para tareas (todos): "today" es solo para hoy, "later" para pendientes sin fecha fija o para más
  adelante, y "routine" para hábitos recurrentes (ejercicio, leer, etc.) que se marcan con
  checkin_routine cada día.
- Para premios y castigos que yo mismo me ponga ligados a mis rutinas/hábitos ("si cumplo la
  semana me premio con...", "si fallo 3 días seguidos me castigo sin..."), regístralos con
  register_reward_punishment (type: reward|punishment) y consúltalos con list_rewards_punishments
  cuando te pregunte por mi historial.
- Puedes enviarle un mensaje a otra persona con send_message (búscala primero en mis contactos con
  list_contacts, o usa el número si te lo doy). Solo úsalo para contactos que yo guardé o conozco -
  nunca para escribirle en frío a alguien nuevo sin que me lo pidas explícitamente.
- Cualquier número de teléfono (add_contact, grant_access, send_message, target de un recordatorio)
  necesita el indicativo de país completo para poder enviarle mensajes (ej. 573001234567, no solo
  3001234567). Si te doy un número de 10 dígitos sin indicativo asumo Colombia (+57) por defecto,
  pero si menciono otro país o el número no calza, pregúntame el indicativo en vez de adivinar.
- Sé proactivo organizando: si algo calza mejor como rutina, fecha importante o recordatorio
  flexible que como tarea puntual, dímelo y sugiéreme la herramienta correcta.
- Todo lo que guardamos (recordatorios, rutinas, links, contactos, etc.) es solo tuyo - si el bot
  tiene otros usuarios, cada quien tiene lo suyo completamente aparte, nadie más lo ve.`;

const ADMIN_PROMPT_ADDENDUM = `

Eres el administrador de este bot. Además de todo lo anterior, puedes darle acceso a otras
personas con grant_access (cada una queda con su propia configuración, sin compartir nada con la
tuya), quitárselo con revoke_access, y ver quién tiene acceso con list_users.`;

/** Builds the system prompt with dynamic context (date, categories, today's pending todos). */
function buildSystemPrompt(userId: number, isAdmin: boolean): string {
  const categories = categoriesRepo.listAll(userId);
  const categoryList = categories.length
    ? categories.map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ''}`).join('\n')
    : '(Todavía no hay categorías creadas.)';

  const todayPending = todosRepo.list(userId, { scope: 'today', status: 'pending' });
  const todayList = todayPending.length
    ? todayPending.map((t) => `- #${t.id} ${t.title}`).join('\n')
    : '(Sin pendientes de hoy.)';

  return [
    BASE_PROMPT + (isAdmin ? ADMIN_PROMPT_ADDENDUM : ''),
    '',
    currentTimeContext(),
    `Hoy es ${todayLocal()}.`,
    '',
    'Categorías existentes:',
    categoryList,
    '',
    'Pendientes de HOY:',
    todayList,
  ].join('\n');
}

/**
 * Processes an incoming WhatsApp message and returns the assistant's reply. Runs the
 * tool-calling loop against the configured LLM, scoped to this specific user - their reminders,
 * todos, contacts, etc. are all separate from any other user of this bot.
 */
export async function processMessage(
  userText: string,
  wa: WaManager,
  user: { id: number; jid: string; isAdmin: boolean },
): Promise<string> {
  const { client, model } = getAiClient();

  const history = messagesRepo.history(user.id, 20);
  messagesRepo.add(user.id, 'user', userText);

  const messages: ChatMsg[] = [
    { role: 'system', content: buildSystemPrompt(user.id, user.isAdmin) },
    ...history.map((m) => ({ role: m.role, content: m.content }) as ChatMsg),
    { role: 'user', content: userText },
  ];

  const ctx: ToolContext = { ownerJid: user.jid, userId: user.id, isAdmin: user.isAdmin, wa };
  const tools = registry.toOpenAITools();

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await client.chat.completions.create({
      model,
      messages,
      tools: tools.length ? tools : undefined,
      tool_choice: tools.length ? 'auto' : undefined,
      temperature: 0.6,
    });

    const choice = res.choices[0]?.message;
    if (!choice) break;
    messages.push(choice as ChatMsg);

    const toolCalls = choice.tool_calls ?? [];
    if (toolCalls.length === 0) {
      const text = (choice.content ?? '').trim() || 'Disculpa, ¿me repites por favor? 🙏';
      messagesRepo.add(user.id, 'assistant', text);
      return text;
    }

    for (const tc of toolCalls) {
      if (tc.type !== 'function') continue;
      const tool = registry.get(tc.function.name);
      let result: string;
      if (!tool) {
        result = `Error: la herramienta "${tc.function.name}" no existe.`;
      } else {
        try {
          const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          console.log(`[TOOL] ${tc.function.name}`, args);
          result = await tool.execute(args, ctx);
        } catch (err) {
          result = `Error al ejecutar ${tc.function.name}: ${(err as Error).message}`;
        }
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }
  }

  const fallback = 'Estoy teniendo problemas para completar eso ahora mismo. ¿Puedes intentarlo de nuevo? 🙏';
  messagesRepo.add(user.id, 'assistant', fallback);
  return fallback;
}
