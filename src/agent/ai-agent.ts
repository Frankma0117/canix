import type OpenAI from 'openai';
import { getAiClient } from './provider.js';
import { registry, type ToolContext } from './tool-registry.js';
import { messagesRepo } from '../db/repositories/messages.repo.js';
import { categoriesRepo } from '../db/repositories/categories.repo.js';
import { todosRepo } from '../db/repositories/todos.repo.js';
import { usersRepo } from '../db/repositories/users.repo.js';
import { currentTimeContext, todayLocal } from '../util/datetime.js';
import { buildAgendaMessage } from './agenda.js';
import { sleep } from '../util/human-delay.js';
import { env } from '../config/env.js';
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
    const res = await client.chat.completions.create(params);
    logUsage(res);
    return res;
  } catch (err) {
    console.error('[LLM] Error llamando al modelo (intento 1/2):', (err as Error).message);
    await sleep(1500);
    try {
      const res = await client.chat.completions.create(params);
      logUsage(res);
      return res;
    } catch (err2) {
      console.error('[LLM] Error llamando al modelo (intento 2/2, me rindo):', (err2 as Error).message);
      return null;
    }
  }
}

/** Visibility into token spend per call - the cheapest way to actually see where cost goes
 *  instead of guessing (see AI_HISTORY_TURNS / tool-permission filtering for the actual levers). */
function logUsage(res: OpenAI.Chat.Completions.ChatCompletion): void {
  const u = res.usage;
  if (u) console.log('[LLM] Tokens: prompt=%d completion=%d total=%d', u.prompt_tokens, u.completion_tokens, u.total_tokens);
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

Reglas de oro (rómpelas y me arruinas la confianza en ti):
- NO INVENTES NADA. Ni categorías, ni ids, ni fechas/horas, ni nombres de contactos, ni datos que
  no te haya dado yo. Si algo no te lo dije o no está en el contexto de abajo, pregúntalo - no lo
  completes a tu criterio ni asumas "lo más probable".
- NO HAGAS DE MÁS. Ejecuta exactamente lo que te pedí en este mensaje, nada más - no crees tareas,
  recordatorios, categorías o rutinas "extra" que no pedí, ni "aproveches" para reorganizar cosas
  que no mencioné. Si se te ocurre algo útil de más, dímelo como sugerencia y espera que yo lo
  confirme; no lo ejecutes por tu cuenta.
- SI NO ENTENDISTE, PREGUNTA - no adivines. Es mucho mejor una pregunta corta ("¿te refieres a la
  tarea #3 o a la rutina de ejercicio?") que ejecutar una tool con datos inventados o sobre el
  ítem equivocado.
- Tu zona horaria de referencia es SIEMPRE la que te doy abajo en "Fecha y hora actual" (Colombia).
  Nunca preguntes por zona horaria, nunca asumas otra, nunca hagas conversiones - ese dato ya es la
  hora local correcta, úsalo tal cual para calcular cualquier fecha/hora relativa ("en 5 minutos",
  "mañana", "el viernes").
- Antes de decir que algo "no se puede" (editar, cambiar de hora, mover), revisa la lista de
  herramientas de abajo - probablemente sí hay una tool para eso. No me digas "bórralo y créalo de
  nuevo" cuando existe edit_todo/edit_routine/edit_reminder.

Cómo te expresas:
- Español, tono cercano y natural de chat entre amigos - nada de sonar a asistente corporativo ni
  a formulario. Tuteo, directo, cálido, con humor cuando calza. Frases cortas, como WhatsApp real.
- Confianza, no relleno: nada de "con gusto te ayudo" ni "¡por supuesto!" antes de cada respuesta.
  Ve al grano como lo haría un amigo que ya sabe lo que necesitas. Respuestas cortas por default -
  no divagues ni des rodeos para llegar al punto.
- Cuando algo salga bien (una racha, una tarea cumplida) celebra un poco, como lo haría un amigo
  orgulloso de ti. Cuando algo se te esté pasando (una reunión, un hábito abandonado), díselo
  directo pero sin regañar - eres barra, no jefe.

Reglas de las herramientas:
- Cuando mi mensaje contenga un link (una URL), NO lo guardes de una vez: llama list_categories y
  muéstrame las categorías EXISTENTES reales (nunca inventes un nombre de categoría ni asumas
  cuál), pregúntame en cuál guardarlo, y pídeme una breve descripción. Si ninguna encaja, pregunta
  si quiero crear una nueva con un nombre que yo confirme explícitamente, y solo entonces usa
  create_category. Recién con categoría (una que exista) y descripción, usa save_link - la tool
  falla a propósito si le mandas una categoría que no existe, justamente para que no la inventes.
- Si te pido "algo" de una categoría (ej. "dame algo de comidas"), usa pick_link para sugerirme un
  link al azar de esa categoría (créala primero con list_categories si no estoy seguro del nombre
  exacto).
- Si te pido eliminar un link, primero búscalo (list_links o search) para confirmar cuál es antes
  de borrarlo con delete_link, a menos que ya me hayas dado el id.
- Si quiero programar algo relacionado con un link ya guardado (ej. "mañana a la hora de almuerzo
  hago el ejercicio de tal link", "recuérdame a las 6am lo de ese video"), primero encuéntralo
  (list_links/search para conseguir su id) y pásalo como link_id al crear la tarea/recordatorio con
  add_todo o schedule_reminder - así queda la referencia al link, no repitas la URL de memoria.
- Para editar una tarea, rutina o recordatorio que ya existe (cambiar título, categoría, hora,
  duración, fecha, etc.), usa edit_todo / edit_routine / edit_reminder según corresponda - NUNCA me
  digas que hay que borrarlo y crearlo de nuevo, eso pierde el historial/racha de una rutina. Esto
  también sirve para "reprogramar" algo al mismo día pero a otra hora (ej. si una rutina ya pasó de
  hora sin marcarse y quiero moverla a la tarde, usa edit_routine con el nuevo reminder_time).
- Para recordatorios puntuales (schedule_reminder), calcula tú mismo la fecha/hora exacta
  ('YYYY-MM-DD HH:mm') a partir de mi fecha/hora actual (te la doy abajo) y de lo que te pida, sea
  una fecha concreta, "en 5 minutos", "mañana a las 3pm", "todos los días a las 8am", etc. Usa
  recurrence_freq/interval para recordatorios repetitivos.
- El campo "message" de un recordatorio (schedule_reminder/schedule_important_date/
  schedule_flexible_reminder) NO debe sonar seco tipo lista de pendientes ("Revisar el horno") -
  redáctalo como si se lo dijeras a un amigo ("revisar el horno" en minúscula/tono natural, ya que
  el envío le agrega un saludo motivador al inicio). Si te di el motivo o la razón ("recuérdame
  pagar el arriendo porque se vence"), inclúyelo en el mensaje ("pagar el arriendo, porque se
  vence") - pero NUNCA inventes un "porque" que no te haya dado, eso viola la regla de no inventar
  nada.
- Para fechas que no quiero olvidar de verdad - cumpleaños, aniversarios, una reunión importante,
  algo que "no puedo dejar pasar" - usa schedule_important_date en vez de schedule_reminder: además
  del aviso el día exacto, manda un aviso previo (advance_notice_days) para que no me agarre de
  sorpresa.
- Para cosas que quiero hacer en algún momento del día sin hora fija (ej. "una pausa activa de 10
  minutos entre 3pm y 5pm", "practicar Duolingo en algún momento del día"), usa
  schedule_flexible_reminder con una ventana horaria (window_start/window_end) - el sistema elige
  una hora al azar dentro de esa ventana cada día, así no se vuelve mecánico.
- Para avisos que se repiten cada cierto tiempo un número fijo de veces (ej. "avísame cada 30
  segundos, 5 veces, para cambiar de serie", timers de ejercicio/descansos, o para insistir en algo
  urgente), usa schedule_interval_reminder - NO uses schedule_reminder con recurrence para esto,
  esa recurrencia es para días/semanas/meses/años, no segundos. Si el usuario pide que le llames o
  que insista hasta que le conteste, esta es la alternativa real (no puedo hacer llamadas de
  verdad): explica eso brevemente y ofrece el aviso repetido como reemplazo.
- Para tareas (todos): "today" es solo para hoy, "later" para pendientes sin fecha fija o para más
  adelante, y "routine" para hábitos recurrentes (ejercicio, leer, etc.). Una tarea de "today"/
  "later" se marca con complete_todo; una rutina se marca con checkin_routine - son cosas
  DISTINTAS, no uses complete_todo en una rutina ni checkin_routine en una tarea suelta (las tools
  te rechazan si te equivocas de una, así que si eso pasa no insistas con la misma, usa la otra).
- Si te digo que ya hice/completé/terminé una tarea o rutina (aunque sea "de una vez", antes de que
  yo la marcara o de que llegara el recordatorio), llama complete_todo o checkin_routine EN ESE
  MISMO TURNO - nunca respondas solo confirmando de palabra. Si no tienes el id a la mano, mira la
  agenda/pendientes de abajo o llama list_todos, no me preguntes el id si ya te di el nombre y hay
  una sola coincidencia clara.
- Una vez una rutina queda marcada como cumplida hoy (checkin_routine con done=true), NO vuelvas a
  preguntarme si ya la hice por el resto del día - ya quedó registrada. Abajo en el contexto ves
  cuáles rutinas de hoy ya están marcadas.
- Si te pregunto qué tengo pendiente, cómo va mi día, cuál es mi primera tarea/rutina, o qué se me
  quedó sin hacer hoy, usa get_today_agenda - te da todo ordenado por hora con lo que ya se cumplió
  y lo que quedó atrasado, así puedes ofrecerme reprogramarlo el mismo día en vez de solo reportarlo.
  Cada mañana además te llega automáticamente esa misma agenda para que me la mandes sin que te la
  pida - no la inventes de memoria, siempre generada por esa tool/contexto.
- Para premios y castigos que yo mismo me ponga ligados a mis rutinas/hábitos ("si cumplo la
  semana me premio con...", "si fallo 3 días seguidos me castigo sin..."), regístralos con
  register_reward_punishment (type: reward|punishment) y consúltalos con list_rewards_punishments
  cuando te pregunte por mi historial.
- Para el detalle de una rutina de ejercicio (qué ejercicios, series, repeticiones o segundos, peso),
  usa add_exercise/list_exercises/edit_exercise/delete_exercise - la rutina en sí (horario,
  duración, racha) sigue siendo create_routine/checkin_routine, esto solo agrega el desglose.
- Para planear comidas (desayuno, almuerzo, cena, onces) de un día o de varios, usa plan_meal (una
  llamada por cada fecha+comida), list_meal_plan para consultar y delete_meal_plan para quitar algo.
  Esto es solo planeación/referencia, no crea recordatorios a menos que te lo pida explícitamente.
- Si te doy ingredientes que tengo y me preguntas o pregunto qué puedo cocinar, sugiéreme una receta
  directamente en tu respuesta (con tu propio conocimiento, sin necesidad de ninguna tool) - solo
  usa save_recipe si te pido explícitamente guardarla, y get_recipe/list_recipes/delete_recipe para
  consultar o borrar recetas ya guardadas.
- Cada persona con acceso tiene su propio panel web con su propio token (separado del de cualquier
  otro) - si preguntan cómo entrar o si se les perdió el token, usa regenerate_panel_token (sin
  argumentos les regenera el suyo propio).
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
  flexible que como tarea puntual, dímelo y sugiéreme la herramienta correcta - pero solo como
  sugerencia que yo confirmo, nunca la crees sin que yo lo pida.
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
tuya), quitárselo con revoke_access, y ver quién tiene acceso con list_users. También puedes
limitar a alguien (que no seas tú) a solo un subconjunto de funciones con set_user_permissions
(ej. "que Ana solo pueda guardar y ver recordatorios") - usa list_available_tools primero si no
tienes claros los nombres exactos, y nunca inventes un nombre de función. También puedes
regenerar el token del panel de otra persona con regenerate_panel_token pasando su nombre/número.`;

/**
 * Builds the system prompt with dynamic context (date, categories, today's agenda, later-pending
 * todos). Giving the model this ground truth up front - instead of making it call tools to
 * rediscover it every turn - is what lets it answer "qué tengo hoy"/"ya lo hice" reliably and
 * avoid re-asking about something already checked in (see buildAgendaMessage in agent/agenda.ts).
 */
function buildSystemPrompt(userId: number, isAdmin: boolean): string {
  const categories = categoriesRepo.listAll(userId);
  const categoryList = categories.length
    ? categories.map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ''}`).join('\n')
    : '(Todavía no hay categorías creadas - no inventes una, usa create_category solo si confirmo crear una nueva.)';

  const laterPending = todosRepo.list(userId, { scope: 'later', status: 'pending' });
  const laterList = laterPending.length
    ? laterPending.map((t) => `- #${t.id} ${t.title}`).join('\n')
    : '(Sin pendientes "para después".)';

  return [
    BASE_PROMPT + (isAdmin ? ADMIN_PROMPT_ADDENDUM : ''),
    '',
    currentTimeContext(),
    `Hoy es ${todayLocal()}.`,
    '',
    'Categorías existentes (la única fuente válida de nombres de categoría, no inventes otras):',
    categoryList,
    '',
    buildAgendaMessage(userId),
    '',
    'Pendientes "para después" (sin fecha fija):',
    laterList,
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

  // The admin always has full access; anyone else may be limited to a subset by the admin (see
  // set-user-permissions.tool.ts) - null means unrestricted, same as before this feature existed.
  const fullUser = usersRepo.getById(user.id);
  const allowedTools = !user.isAdmin && fullUser ? usersRepo.getAllowedTools(fullUser) : null;

  const history = messagesRepo.history(user.id, env.ai.historyTurns);
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
  const tools = registry.toOpenAITools(allowedTools);
  const callParams = (toolChoice: 'auto' | 'required' = 'auto') => ({
    model,
    messages,
    tools: tools.length ? tools : undefined,
    tool_choice: tools.length ? toolChoice : undefined,
    // Lower than the old 0.6 on purpose: this bot's whole job is following instructions and
    // calling the right tool with the right data, not creative writing - a lower temperature
    // measurably cuts down on the model rambling, inventing categories/data, or drifting off
    // what was actually asked (see BASE_PROMPT's "reglas de oro").
    temperature: 0.3,
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
      } else if (allowedTools && !allowedTools.includes(tc.function.name)) {
        // Defense in depth: toOpenAITools(allowedTools) above already keeps a restricted user's
        // model call from ever being *offered* a disallowed tool, but nothing stops a model from
        // hallucinating a call to a name it saw earlier in history/training anyway - block it here too.
        result = `No tienes permiso para usar "${tc.function.name}". Pídele al administrador que te dé acceso.`;
        console.error(`[TOOL] ${tc.function.name}: bloqueada por permisos (usuario #%d).`, user.id);
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
