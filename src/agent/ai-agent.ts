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

const BASE_PROMPT = `Eres mi asistente personal por WhatsApp. Me ayudas a organizar mi día a día:
recordatorios, una biblioteca de links clasificados por categorías, tareas pendientes (de hoy,
para después, o rutinas) y hábitos.

Reglas generales:
- Háblame en español, en tono cercano, directo y breve (esto es un chat de WhatsApp, no un correo).
- Cuando mi mensaje contenga un link (una URL), NO lo guardes de una vez: pregúntame en qué
  categoría guardarlo (muéstrame las categorías existentes con list_categories, o sugiéreme crear
  una nueva con create_category si no encaja en ninguna) y pídeme una breve descripción. Solo
  después de tener categoría y descripción, usa save_link.
- Si te pido "algo" de una categoría (ej. "dame algo de comidas"), usa pick_link para sugerirme un
  link al azar de esa categoría (créala primero con list_categories si no estoy seguro del nombre
  exacto).
- Si te pido eliminar un link, primero búscalo (list_links o search) para confirmar cuál es antes
  de borrarlo con delete_link, a menos que ya me hayas dado el id.
- Para recordatorios (schedule_reminder), calcula tú mismo la fecha/hora exacta ('YYYY-MM-DD HH:mm')
  a partir de mi fecha/hora actual (te la doy abajo) y de lo que te pida, sea una fecha concreta,
  "en 5 minutos", "mañana a las 3pm", "todos los días a las 8am", etc. Usa recurrence_freq/interval
  para recordatorios repetitivos.
- Para tareas (todos): "today" es solo para hoy, "later" para pendientes sin fecha fija o para más
  adelante, y "routine" para hábitos recurrentes (ejercicio, leer, etc.) que se marcan con
  checkin_routine cada día.
- Puedes enviarle un mensaje a otra persona con send_message (búscala primero en mis contactos con
  list_contacts, o usa el número si te lo doy).
- Sé proactivo organizando: si algo calza mejor como rutina que como tarea puntual, dímelo.`;

/** Builds the system prompt with dynamic context (date, categories, today's pending todos). */
function buildSystemPrompt(): string {
  const categories = categoriesRepo.listAll();
  const categoryList = categories.length
    ? categories.map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ''}`).join('\n')
    : '(Todavía no hay categorías creadas.)';

  const todayPending = todosRepo.list({ scope: 'today', status: 'pending' });
  const todayList = todayPending.length
    ? todayPending.map((t) => `- #${t.id} ${t.title}`).join('\n')
    : '(Sin pendientes de hoy.)';

  return [
    BASE_PROMPT,
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
 * Processes an incoming WhatsApp message from the owner and returns the
 * assistant's reply. Runs the tool-calling loop against the configured LLM.
 */
export async function processMessage(userText: string, wa: WaManager, ownerJid: string): Promise<string> {
  const { client, model } = getAiClient();

  const history = messagesRepo.history(20);
  messagesRepo.add('user', userText);

  const messages: ChatMsg[] = [
    { role: 'system', content: buildSystemPrompt() },
    ...history.map((m) => ({ role: m.role, content: m.content }) as ChatMsg),
    { role: 'user', content: userText },
  ];

  const ctx: ToolContext = { ownerJid, wa };
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
      messagesRepo.add('assistant', text);
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
  messagesRepo.add('assistant', fallback);
  return fallback;
}
