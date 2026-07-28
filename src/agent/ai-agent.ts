import type OpenAI from 'openai';
import { getAiClient } from './provider.js';
import { registry, type ToolContext } from './tool-registry.js';
import { messagesRepo } from '../db/repositories/messages.repo.js';
import { categoriesRepo } from '../db/repositories/categories.repo.js';
import { todosRepo } from '../db/repositories/todos.repo.js';
import { currentTimeContext, todayLocal } from '../util/datetime.js';
import { sleep } from '../util/human-delay.js';
import type { WaManager } from '../whatsapp/wa-manager.js';

const MAX_ITERATIONS = 6;

/**
 * The AI provider (network hiccup, rate limit, timeout, etc.) is the single most likely point of
 * failure in the whole message loop - without this, any blip there meant the user got no reply
 * at all (see bot-manager.ts's outer catch, which is only a last-resort safety net, not something
 * to rely on for routine flakiness). One retry after a short pause covers most transient errors;
 * if it still fails, this returns a clear message instead of throwing, so the caller always gets
 * *something* back to send the user - never silence.
 */
async function callModelWithRetry(
  client: OpenAI,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
): Promise<OpenAI.Chat.Completions.ChatCompletion | null> {
  try {
    return await client.chat.completions.create(params);
  } catch (err) {
    console.error('[LLM] Error llamando al modelo (intento 1/2):', (err as Error).message);
    await sleep(1500);
    try {
      return await client.chat.completions.create(params);
    } catch (err2) {
      console.error('[LLM] Error llamando al modelo (intento 2/2, me rindo):', (err2 as Error).message);
      return null;
    }
  }
}

type ChatMsg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/** True when text looks like it ends in a question - used to spot "I asked you something, this
 *  reply is the answer" turns, so we can make sure the follow-through tool call actually happens. */
function looksLikeQuestion(text: string): boolean {
  return /[?¿]\s*$/.test(text.trim());
}

/**
 * Matches the model claiming an action is already done ("ya se envió", "listo, ya", "guardado",
 * etc.). If this shows up in a turn that called zero tools, the claim can't possibly be true -
 * nothing actually ran - so this is a reliable, low-false-positive signal of a hallucinated
 * completion (as opposed to `previousTurnWasQuestion`, which is a weaker, broader hint: it also
 * matches a plain "no gracias" reply to a generic closing question, where no tool call is needed).
 */
const CLAIMED_DONE_RE =
  /\b(ya\s+(le\s+|te\s+|lo\s+|la\s+)?(lleg[oó]|envi[eé]|mand[eé]|guard[eé]|program[eé]|agregu[eé]|cre[eé]|elimin[eé]|borr[eé]|cancel[eé]|marqu[eé]|regist(r[eé]|r[oó])|complet[eé]|termin[eé]|hice|qued[oó])|list[oa],?\s+ya\b|\b(hecho|enviado|guardado|programado|eliminado|registrado|agregado|cancelado)\b)/i;

const FORCE_TOOL_REMINDER =
  'Tu turno anterior fue una pregunta para completar una acción pendiente (te faltaba un dato), o ' +
  'dijiste que ya hiciste algo sin haber llamado ninguna tool - lo segundo es imposible, nada se ' +
  'ejecutó todavía. Mi mensaje de ahora es la respuesta/información que te hacía falta. AHORA debes ' +
  'llamar la tool correspondiente con ese dato, en este mismo turno. No respondas solo con texto ' +
  'confirmando algo que no has hecho.';

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
- Si te pido explícitamente que le mandes un mensaje a alguien ("envíale un mensaje a X diciendo
  Y", "dile a X que...", etc.), USA send_message DE UNA VEZ - no lo pienses de más, no me
  preguntes "¿seguro?" ni pidas confirmación extra, esa petición explícita ya es el permiso. Si me
  diste un nombre, pásalo tal cual en "to" (send_message ya lo busca en mis contactos); si me diste
  un número, pásalo directo en "to" también. Lo único que NO debes hacer es escribirle a alguien
  nuevo por tu cuenta, sin que yo te lo haya pedido en este mensaje.
- Cualquier número de teléfono (add_contact, grant_access, send_message, target de un recordatorio)
  necesita el indicativo de país completo para poder enviarle mensajes (ej. 573001234567, no solo
  3001234567). Si te doy un número de 10 dígitos sin indicativo asumo Colombia (+57) por defecto así
  que puedes usarlo tal cual - no hace falta que me preguntes por el indicativo en ese caso.
- Sé proactivo organizando: si algo calza mejor como rutina, fecha importante o recordatorio
  flexible que como tarea puntual, dímelo y sugiéreme la herramienta correcta.
- Todo lo que guardamos (recordatorios, rutinas, links, contactos, etc.) es solo tuyo - si el bot
  tiene otros usuarios, cada quien tiene lo suyo completamente aparte, nadie más lo ve.
- NUNCA digas que ya hiciste algo (que ya mandaste un mensaje, guardaste un link, programaste un
  recordatorio, etc.) sin haber llamado la tool correspondiente EN ESE MISMO TURNO. Si te falta un
  dato para completar una acción (ej. "envíale un mensaje a Juan" sin decir qué), pregúntalo - pero
  en cuanto te responda con ese dato, tu respuesta en ese turno DEBE ser la llamada a la tool, no
  una confirmación de texto fingiendo que ya se hizo. Ejemplo: yo digo "mándale un mensaje a Ana",
  tú preguntas "¿qué le digo?", yo respondo "que llego tarde" -> ahí mismo llamas a send_message
  con to="Ana", message="que llego tarde". No respondas solo "listo, ya le llegó" sin haber hecho esa
  llamada - eso sería mentirme.`;

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
  // If my last turn was a bare clarifying question, this incoming message is almost certainly the
  // answer to it - flags the "answer arrived, now actually call the tool" corrective retry below.
  const lastAssistantMsg = [...history].reverse().find((m) => m.role === 'assistant');
  const previousTurnWasQuestion = !!lastAssistantMsg && looksLikeQuestion(lastAssistantMsg.content);

  messagesRepo.add(user.id, 'user', userText);

  const messages: ChatMsg[] = [
    { role: 'system', content: buildSystemPrompt(user.id, user.isAdmin) },
    ...history.map((m) => ({ role: m.role, content: m.content }) as ChatMsg),
    { role: 'user', content: userText },
  ];

  const ctx: ToolContext = { ownerJid: user.jid, userId: user.id, isAdmin: user.isAdmin, wa };
  const tools = registry.toOpenAITools();
  const callParams = (toolChoice: 'auto' | 'required' = 'auto') => ({
    model,
    messages,
    tools: tools.length ? tools : undefined,
    tool_choice: tools.length ? toolChoice : undefined,
    temperature: 0.6,
  });
  // "guard=v2" is just a version marker (not functional) so we can tell from any pasted log
  // snippet whether this build (with the hallucination-guard retry below) is actually the one
  // running, instead of guessing - if a log doesn't say guard=v2, the process wasn't restarted.
  console.log(
    '[LLM] #%d -> "%s" (modelo=%s, %d tools disponibles, guard=v2, previousTurnWasQuestion=%s)',
    user.id,
    userText,
    model,
    tools.length,
    previousTurnWasQuestion,
  );

  let forcedRetryUsed = false;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await callModelWithRetry(client, callParams());

    if (!res) {
      const text =
        '⚠️ Tuve un problema técnico conectándome ahora mismo, ya quedó registrado. Intenta de nuevo ' +
        'en un momento - si te sigue pasando seguido, avísale al administrador.';
      messagesRepo.add(user.id, 'assistant', text);
      return text;
    }

    let choice = res.choices[0]?.message;
    if (!choice) {
      console.log('[LLM] Iteracion %d: la respuesta no trajo ningun choice, corto el loop.', i);
      break;
    }

    let toolCalls = choice.tool_calls ?? [];
    console.log(
      '[LLM] Iteracion %d: finish_reason=%s, tool_calls=%d%s',
      i,
      res.choices[0]?.finish_reason ?? '?',
      toolCalls.length,
      toolCalls.length ? ` (${toolCalls.map((t) => (t.type === 'function' ? t.function.name : t.type)).join(', ')})` : '',
    );

    // Caught the model either (a) claiming it already did something while calling zero tools -
    // that claim can't be true, nothing ran - or (b) staying silent on the tool right after
    // asking a clarifying question whose answer just arrived. Force exactly one corrective retry
    // with tool_choice="required" (DeepSeek's API supports it, same as OpenAI's) - this
    // *guarantees* a tool call this time, no way for the model to hallucinate its way out again.
    // (Earlier this only forced "required" for case (a) and used a soft "auto" nudge for (b) alone,
    // to avoid forcing an unwanted call on a benign "no gracias" reply - but real traffic showed
    // the soft nudge can itself still hallucinate a second time with nothing left to catch it, and
    // that failure mode (falsely claiming a message was sent) is far worse than an occasional
    // unnecessary tool call, so both cases now force it.)
    const claimsCompletion = CLAIMED_DONE_RE.test(choice.content ?? '');
    if (toolCalls.length === 0 && i === 0 && !forcedRetryUsed && (claimsCompletion || previousTurnWasQuestion)) {
      forcedRetryUsed = true;
      console.log(
        '[LLM] %s - reintento forzado (tool_choice=required).',
        claimsCompletion
          ? 'El modelo dijo que ya hizo algo sin llamar ninguna tool'
          : 'Respuesta sin accion justo tras una pregunta pendiente',
      );
      messages.push(choice as ChatMsg);
      messages.push({ role: 'system', content: FORCE_TOOL_REMINDER });
      const res2 = await callModelWithRetry(client, callParams('required'));
      const choice2 = res2?.choices[0]?.message;
      if (choice2) {
        choice = choice2;
        toolCalls = choice2.tool_calls ?? [];
        console.log(
          '[LLM] Reintento forzado: tool_calls=%d%s',
          toolCalls.length,
          toolCalls.length ? ` (${toolCalls.map((t) => (t.type === 'function' ? t.function.name : t.type)).join(', ')})` : '',
        );
      }
    }

    messages.push(choice as ChatMsg);

    if (toolCalls.length === 0) {
      const text = (choice.content ?? '').trim() || 'Disculpa, ¿me repites por favor? 🙏';
      console.log('[LLM] Sin tool calls, respondo directo: "%s"', text);
      messagesRepo.add(user.id, 'assistant', text);
      return text;
    }

    for (const tc of toolCalls) {
      if (tc.type !== 'function') continue;
      const tool = registry.get(tc.function.name);
      let result: string;
      if (!tool) {
        result = `Error: la herramienta "${tc.function.name}" no existe.`;
        console.error(`[TOOL] ${tc.function.name}: no existe en el registro.`);
      } else {
        try {
          const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          console.log(`[TOOL] ${tc.function.name}(%s)`, JSON.stringify(args));
          result = await tool.execute(args, ctx);
          console.log(`[TOOL] ${tc.function.name} -> "%s"`, result.length > 300 ? `${result.slice(0, 300)}…` : result);
        } catch (err) {
          result = `Error al ejecutar ${tc.function.name}: ${(err as Error).message}`;
          console.error(`[TOOL] ${tc.function.name} fallo:`, (err as Error).message);
        }
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }
  }

  const fallback = 'Estoy teniendo problemas para completar eso ahora mismo. ¿Puedes intentarlo de nuevo? 🙏';
  messagesRepo.add(user.id, 'assistant', fallback);
  return fallback;
}
