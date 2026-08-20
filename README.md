# Canix 🗂️

Asistente personal por WhatsApp: recordatorios, una biblioteca de links clasificados por
categorías, tareas (de hoy, para después o rutinas) y seguimiento de hábitos. Es **multi-usuario**
pero de acceso cerrado: tú eres el administrador (y también usuario), y le das acceso a quien
quieras — cada persona tiene su propia configuración completamente separada, nada se comparte.
Misma arquitectura que [estylia](../estylia) (Baileys + agente de IA con tools + scheduler),
simplificada para uso personal: sin multi-negocio, con SQLite en vez de MySQL.

## Características

- ⏰ **Recordatorios**: "recuérdame X en 5 minutos", "el 15 de agosto a las 9am", "todos los
  lunes a las 8am". Soportan repetición (diaria/semanal/mensual/anual) y se pueden enviar a ti
  o a un contacto guardado.
- 🔗 **Links por categoría**: le envías un link por WhatsApp y el bot te pregunta en qué
  categoría guardarlo y una breve descripción antes de guardarlo. Las categorías las creas tú
  (por chat o desde el panel) - el bot nunca inventa ni crea una categoría nueva por su cuenta,
  siempre te muestra las que ya existen primero. También puedes programar una tarea/recordatorio
  sobre un link ya guardado ("mañana a la hora de almuerzo hago el ejercicio de tal link", "a las
  6am recuérdame lo de ese video") y queda la referencia al link, no solo el texto.
- 🎲 **Consultar una categoría**: "dame algo de comidas" te sugiere un link al azar de esa
  categoría (prioriza los que no has usado hace tiempo).
- 🗑️ **Eliminar links**: le pides borrar uno, el bot lo busca y confirma antes de eliminarlo.
- ✅ **Tareas**: "hoy" (solo para el día), "para después" (sin fecha fija) y "rutinas" (hábitos
  recurrentes con seguimiento diario/semanal y racha). Se pueden **editar** (título, categoría,
  fecha, hora, duración) sin borrarlas y volver a crearlas - por chat (`edit_todo`/`edit_routine`,
  editar una rutina conserva su historial/racha) o desde el panel.
- 📝 **Notas importantes**: información suelta que quieres poder recuperar después (una idea, un
  dato, algo que te dijeron) - a diferencia de una tarea o recordatorio, no tiene fecha ni hora ni
  se marca como cumplida. "Anota que el wifi de la oficina es tal clave", y después "busca mis
  notas sobre wifi" o "muéstrame mis notas de trabajo" (categoría opcional, misma tabla de
  categorías que usan los links).
- 🌅 **Agenda del día**: cada mañana (hora configurable, `MORNING_SUMMARY_TIME`) te llega
  automáticamente el orden del día completo - rutinas, recordatorios y tareas de hoy, empezando
  por lo primero. Pregúntalo en cualquier momento ("¿qué tengo hoy?", "¿cómo va mi día?") y también
  te dice qué rutina ya pasó de hora sin marcarse, para que la reprogrames el mismo día si quieres.
- 📊 **Resumen semanal**: cada semana (día/hora configurable, `WEEKLY_REPORT_DAY`/`WEEKLY_REPORT_TIME`)
  te llega cuánto cumpliste en los últimos 7 días, separado en rutinas (días cumplidos + racha) y
  tareas de una sola vez (cumplidas vs pendientes). Pregúntalo en cualquier momento ("¿cómo me fue
  esta semana?") con `get_week_report`.
- 🎉 **Stickers de celebración**: al marcar una tarea o rutina como hecha, además del mensaje de
  confirmación te llega un sticker (100% local, generado sin IA/tokens - ver `util/stickers.ts`).
- 💬 **Enviar mensajes**: "envíale un mensaje a Juan diciéndole que..." — busca el contacto
  guardado y lo envía por WhatsApp.
- 📅 **Fechas importantes**: cumpleaños, aniversarios, reuniones que no puedes dejar pasar. A
  diferencia de un recordatorio normal, además avisa unos días antes (`schedule_important_date`).
- 🎲 **Recordatorios flexibles**: cosas sin hora fija ("pausa activa entre 3pm y 5pm", "Duolingo
  en algún momento del día") — cada día elige una hora al azar dentro de la ventana que le des
  (`schedule_flexible_reminder`), para que no se sienta mecánico.
- 🏆 **Premios y castigos**: te los pones tú mismo ligados a tus rutinas ("si cumplo la semana me
  premio con...") y quedan registrados, por chat o desde el panel.
- 🎙️ **Notas de voz**: si le mandas un audio, lo transcribe localmente (Vosk, sin IA/tokens) y
  te responde en texto y también con nota de voz (Piper, también local) — ver sección "Audio" más abajo.
- 👥 **Multi-usuario**: le das acceso a alguien con `grant_access` ("dale acceso a 573001234567
  como Juan") y desde ahí tiene su propio bot — sus recordatorios, rutinas, contactos, links,
  categorías, todo separado del tuyo. Se lo quitas con `revoke_access`.
- 🗑️ **Eliminar de todo**: rutinas, recordatorios (cancelar o borrar), contactos, categorías y
  premios/castigos se pueden borrar por chat (`delete_routine`, `delete_reminder`,
  `delete_contact`, `delete_category`, `delete_reward_punishment`) o desde el panel.
- 📊 **Panel web** (`admin-panel/`): ver/editar categorías, links, tareas, rutinas (con racha),
  premios/castigos, recordatorios y contactos. Cada persona con acceso (admin o quien recibió
  `grant_access`) tiene su propio token aleatorio y su propio panel, con solo sus datos - la
  gestión de la conexión de WhatsApp sigue siendo solo del administrador.

El bot habla como un amigo cercano (no como un asistente formal) — ver `BASE_PROMPT` en
`src/agent/ai-agent.ts` si quieres ajustar el tono a tu propia forma de hablar. Además, cada
respuesta espera un poco antes de enviarse (simulando que está "escribiendo") para no parecer un
bot automatizado respondiendo al instante — ver "Cómo evitar que WhatsApp bloquee/restrinja el
número" más abajo.

## Diferencias importantes con estylia

- **Un número dedicado para el bot** (no tu WhatsApp personal): vincula un número aparte (chip
  extra, WhatsApp Business, etc.) y escríbele desde tu WhatsApp de siempre. La primera persona que
  le escribe queda registrada como **administrador** (tú) — cualquier otro número recibe una
  respuesta genérica hasta que el admin le dé acceso con `grant_access` (ver "Multi-usuario" abajo).
- **SQLite en vez de MySQL**: todo vive en un solo archivo (`data/app.db`), no necesitas levantar
  ningún servidor de base de datos.
- **Baileys necesita Node.js 20+** para instalarse (el paquete lo exige desde su script de
  `preinstall`). Si el `node` por defecto de tu sistema es más viejo (como en esta máquina, que
  tiene Node 18), usa el Node 20 que ya tienes en `C:\Users\Asus\node20` — los scripts
  `install.cmd`/`start.cmd`/`db-init.cmd` ya lo hacen por ti.

## Instalación

```bash
# Windows: usa los .cmd (ya apuntan al Node 20 correcto)
install.cmd

# o manualmente (asegúrate de tener Node 20+ activo primero):
npm install
cp .env.example .env      # y edita tus valores (sobre todo AI_API_KEY)
cd admin-panel && npm install && npm run build && cd ..
```

### 1. Configura `.env`

Solo necesitas definir `AI_API_KEY` (y opcionalmente el modelo/proveedor). La base de datos
SQLite y su carpeta se crean solas.

### 2. Ejecuta

```bash
start.cmd
# o: npm run start
```

- La primera vez se crea el esquema SQLite automáticamente.
- En la consola aparece un **QR**: escanéalo desde WhatsApp (del número dedicado al bot) →
  *Dispositivos vinculados*.
- El panel web queda en **http://localhost:3000** (token del administrador impreso en consola, o
  defínelo en `ADMIN_TOKEN`). Cada persona a la que le des acceso con `grant_access` recibe su
  propio token aleatorio por WhatsApp para entrar a su propio panel.
- El **primer número que le escriba al bot** por WhatsApp queda registrado como **administrador**.
  Desde ahí puedes darle acceso a otras personas con `grant_access` — ver "Multi-usuario" abajo.

## Comandos

Comandos con barra (`/`) - se resuelven directo, sin pasar por la IA (cero tokens):

| Comando | Qué hace |
| --- | --- |
| `/menu` | Menú principal: categorías de todo lo que el bot puede hacer |
| `/menu <categoría>` | Detalle de una categoría - ej. `/menu recordatorios`, `/menu 1`, `/menu fashion` |
| `/ayuda` (o `/help`) | Resumen rápido de estos mismos comandos |
| `/reset` | Borra el historial de esta conversación (tu información no se toca) |
| `/reset todo` | Borra TODA tu información (pide confirmación explícita antes de ejecutar) |

`/menu` está pensado como el punto de entrada "moderno": un nivel principal con las categorías
numeradas, y un segundo nivel de detalle por categoría (`agent/menu.ts` es la única fuente de este
contenido - la tool `show_menu`, que la IA usa cuando le preguntás "qué puedes hacer" en lenguaje
natural, renderiza exactamente el mismo menú principal). Las categorías de Fashion Mode y de
administrador solo aparecen si corresponden (`FASHION_MODE_ENABLED=true` / sos admin).

Todo lo demás no necesita comando - simplemente pedíselo al bot hablando normal.

## Ejemplos de uso (por WhatsApp)

- "Recuérdame llamar al dentista mañana a las 10am"
- "Todos los días a las 7am recuérdame tomar la pastilla"
- Enviar un link → el bot pregunta categoría y descripción → queda guardado
- "Dame algo de la categoría películas"
- "Elimina el link de [tema]"
- "Agrega a mis pendientes de hoy: pagar el arriendo"
- "Crea una rutina de ejercicio diaria a las 7am, 30 minutos" (toda rutina necesita hora + duración)
- "Ya hice ejercicio hoy" (marca el check-in del día)
- "¿Qué tengo pendiente hoy?"
- "Envíale un mensaje a Ana diciéndole que llego en 10 minutos"
- "El cumpleaños de mi mamá es el 12 de marzo, avísame 3 días antes" (fecha importante)
- "Recuérdame estirar en algún momento entre las 3pm y las 5pm todos los días" (recordatorio flexible)
- "Si cumplo la rutina de ejercicio toda la semana me premio con salir a cine" (premio ligado a rutina)
- "Borra la rutina de ejercicio" / "elimina el contacto de Ana" / "borra esa categoría" (eliminar)
- "Dale acceso a 573001234567 como Juan" (solo el admin — ver "Multi-usuario")
- Mándale una nota de voz — la transcribe y te responde en texto + audio.

## Multi-usuario

El bot admite varias personas con acceso, cada una con su información **completamente separada**
(recordatorios, rutinas, contactos, links, categorías, premios/castigos, historial de chat) — nadie
ve lo del otro, ni siquiera el administrador.

- **Tú eres el administrador** (el primer número que le escribió al bot) y también usuario normal:
  tienes tu propia configuración igual que cualquiera.
- **Dar acceso**: pídeselo al bot por chat — *"dale acceso a 573001234567 como Juan"*
  (`grant_access`, solo funciona si lo pide el admin).
- **Quitar acceso**: *"quítale el acceso a Juan"* (`revoke_access`) — borra toda su información,
  no se puede deshacer.
- **Ver quién tiene acceso**: *"¿quién tiene acceso al bot?"* (`list_users`) - también muestra si
  alguien tiene funciones restringidas (ver `set_user_permissions` más abajo).
- **Restringir funciones**: *"que Juan solo pueda guardar y ver recordatorios"*
  (`set_user_permissions`) — limita a alguien (nunca al admin) a un subconjunto de herramientas;
  *"dale acceso completo a Juan de nuevo"* para quitar la restricción.
- El panel web (`admin-panel/`) muestra y edita **los datos de quien inició sesión con su token** -
  cada persona con acceso (admin o no) tiene el suyo propio y solo ve lo suyo. La gestión de la
  conexión de WhatsApp en sí (página "Conexión") sigue siendo solo del administrador.

**LID de WhatsApp**: además del número de teléfono, el bot guarda el `@lid` (el identificador
"privado" que WhatsApp usa cada vez más en vez del número) de usuarios y contactos apenas lo
aprende del tráfico (`sock.ev.on('lid-mapping.update', ...)` en `wa-manager.ts`). Al enviar un
mensaje, si ya se conoce el lid de ese contacto se usa ese en vez del jid de teléfono — evita
fallos al enviar a cuentas con la privacidad restringida. No requiere configuración.

## Rutinas: aviso + chequeo

Toda rutina necesita una **hora de recordatorio** y una **duración** — no son opcionales. El bot
avisa a esa hora y, al terminar la duración, pregunta si se cumplió:

> "leer a las 8, 30 minutos" → a las 8:00 avisa *"⏰ Hora de: Leer"*, a las 8:30 pregunta
> *"✅ ¿Cumpliste con 'Leer'?"*

Internamente esto crea la rutina más dos recordatorios ligados a ella (`kind: routine_reminder` /
`routine_checkin`, ver `src/agent/routine-setup.ts`) — al borrar la rutina, ambos se borran
también (`ON DELETE CASCADE`). Responder la pregunta de chequeo no marca nada automáticamente:
dile al bot que sí/no cumpliste y él llama `checkin_routine` por ti.

Si ya marcaste la rutina como cumplida (por ejemplo la hiciste antes de la hora avisada), el
chequeo automático de esa hora **no vuelve a preguntar** — el scheduler revisa si ya hay un
`habit_log` del día antes de mandar la pregunta (ver `task-scheduler.ts`). Y si quieres cambiarle
la hora, duración, nombre o categoría a una rutina ya creada, usa `edit_routine` (o el lápiz en el
panel) en vez de borrarla y crearla de nuevo - así no pierdes el historial ni la racha.

## Audio: transcripción y voz (100% local)

Transcribir notas de voz y responder con audio corre **completamente local**, sin llamar a
ninguna IA ni gastar tokens — son dos programas aparte que corren en tu propio servidor:

- **Transcripción (Vosk)**: cuando mandas una nota de voz, se descarga, se convierte a PCM16
  16kHz con `ffmpeg` (incluido vía `ffmpeg-static`, no hace falta instalarlo aparte) y se pasa a
  un modelo de [Vosk](https://alphacephei.com/vosk/models) cargado localmente.
- **Respuesta por voz (Piper)**: si te respondió a una nota de voz, además del texto intenta
  generar una nota de voz con [Piper](https://github.com/rhasspy/piper) (voz neuronal offline,
  bastante natural) y convertirla a ogg/opus para WhatsApp.

Ambas son **opcionales y se degradan solas**: si no configuras el modelo/binario, esa función
simplemente queda desactivada (el bot te pide texto en vez de transcribir; responde solo en texto
en vez de mandar audio) — no rompe nada del resto del bot.

### Instalación automática (servidor Ubuntu)

```bash
./deploy.sh
```

`./deploy.sh` ya incluye esto por defecto (junto con todo lo demás — código, dependencias, visión).
Descarga el modelo de Vosk en español, el binario de Piper (última versión, linux x64) y una voz
en español, todo en `/opt/canix/models` y `/opt/canix/bin`, escribe las 3 variables resultantes
directo en `.env` y reinicia el bot — sin pasos manuales. Seguro de re-correr (omite lo que ya esté
descargado, y no toca una variable que ya hayas puesto a mano). También se puede correr suelto,
`deploy/ubuntu-04-setup-audio.sh`, si ya tienes `/opt/canix` desplegado y solo quieres agregar
audio (en ese caso reinicia el bot vos mismo al final, el script te lo recuerda).

### Instalación manual

1. **Vosk**: descarga un modelo en español de https://alphacephei.com/vosk/models (recomendado
   para empezar: `vosk-model-small-es-0.42`, ~40MB — hay uno más grande y preciso si tu servidor
   aguanta más RAM/CPU), descomprímelo en `./models/vosk-es`, y define
   `VOSK_MODEL_PATH=./models/vosk-es` en tu `.env` (o déjalo así, es el default).
2. **Piper**: descarga el binario para tu plataforma de https://github.com/rhasspy/piper/releases
   (en el servidor Linux, `piper_linux_x86_64.tar.gz`) y descomprímelo entero (trae sus `.so`
   junto al ejecutable, no muevas solo el binario). Descarga una voz en español (par de archivos
   `.onnx` + `.onnx.json`) de https://huggingface.co/rhasspy/piper-voices — por ejemplo
   `es_ES-davefx-medium`. Define `PIPER_BIN_PATH` (ruta al ejecutable `piper` dentro de la carpeta
   descomprimida) y `PIPER_VOICE_PATH` (ruta al `.onnx`) en tu `.env`.

## Fashion Mode (armario y outfits)

Módulo aislado y opcional para gestionar tu armario por WhatsApp: mandas fotos de tus prendas, el
bot las clasifica (tipo, categoría, color, estilo) y las guarda organizadas. Completamente separado
del resto del bot — recordatorios, rutinas y tareas no se ven afectados exista o no este módulo.

**Estado actual**: implementado de punta a punta - activar/salir del modo, agregar prendas por foto
(una por una, o **en lote mandando un PDF** con varias fotos - ver abajo) con clasificación
asistida (microservicio de visión, ver abajo) o manual, ver tu armario con filtros y paginación,
editar/marcar favorito/eliminar prendas, y el motor de recomendación de outfits (`outfit para una
boda`) con filtrado local + DeepSeek solo sobre los candidatos reducidos, guardado de outfits
favoritos y control de uso de IA. Pendiente: batería de tests automatizados (el proyecto no tiene
suite de tests todavía, no es algo específico de este módulo).

**Agregar prendas desde un PDF**: dentro de Fashion Mode (o directamente al escribir "agregar
prenda"), en vez de mandar una foto podés mandar un PDF con varias fotos de prendas pegadas adentro
- el bot extrae cada imagen (vía el microservicio de visión, ver `vision-service/README.md`'s
`/extract-pdf`), las clasifica una por una igual que a una foto suelta, y te muestra un resumen de
todo el lote para revisar antes de guardar:

```
📄 Encontré 4 prenda(s):

1. Camisa - blanco
2. Jeans - azul
3. ⚠️ no se pudo clasificar automáticamente
4. Tenis - blanco

✅ "guardar todas" - guarda las que se pudieron clasificar
🔢 escribe el número de una prenda para corregirla (ej. "3")
❌ "cancelar" - descarta todo el lote, no guarda nada
```

Solo extrae imágenes que ya están embebidas como fotos dentro del PDF (no renderiza páginas
completas) - sirve para un PDF armado pegando fotos, no para un PDF de puro texto/vectores.
Controlado por `FASHION_MAX_PDF_SIZE_MB` (tamaño máximo del PDF) y `FASHION_MAX_PDF_IMAGES` (tope
de fotos procesadas por lote, para no saturar RAM ni mandar demasiado de una vez).

- 🔒 **Apagado por defecto**: `FASHION_MODE_ENABLED=false` dejando todo el bot exactamente como
  hoy. Actívalo solo cuando tengas Spaces y (opcionalmente) el servicio de visión configurados.
- 👔 **Activar**: escribe `fashion`, `moda`, `outfit` o `armario` en cualquier momento. `salir`
  (o `cancelar` a mitad de un flujo) para volver al chat normal — nunca toca tu historial de
  conversación general.
- 📸 **Agregar prenda**: dentro del modo, "agregar prenda" y mandas una foto. Si el servicio de
  visión (ver abajo) está corriendo, la clasifica automáticamente y te pide confirmar o corregir;
  si no, te pregunta tipo/categoría/color con opciones numeradas — nunca bloquea el flujo.
- 👗 **Consultar**: `armario`, `armario camisas`, `armario azul`, `armario favoritos` — filtros
  resueltos localmente, sin gastar IA. Paginado de a 10.
- 🖼️ **Almacenamiento**: las fotos originales se suben a DigitalOcean Spaces (bucket público-solo-
  lectura) — configura `DO_SPACES_*` en `.env` (ver tabla de variables abajo). El Secret Access Key
  nunca va en el código ni se comparte por chat, solo en tu `.env`.
- 🧠 **Clasificación por IA — local y gratis**: DeepSeek (el proveedor de IA configurado para el
  resto del bot) no tiene visión, así que Fashion Mode usa un microservicio Python separado
  (`vision-service/`, modelo CLIP corriendo en tu propio servidor, sin ninguna API paga) - ver
  `vision-service/README.md` para instalación y, muy importante, cómo verificar el uso de RAM en tu
  servidor antes de dejarlo corriendo en producción. Si ese servicio no está corriendo, Fashion Mode
  simplemente pide clasificar la prenda a mano.

## Cómo agregar una nueva tool

1. Crea `src/agent/tools/mi-tool.tool.ts` exportando un objeto `Tool`.
2. Regístrala en `src/agent/tools/index.ts`.

```ts
import type { Tool } from '../tool-registry.js';

export const miTool: Tool = {
  name: 'mi_tool',
  description: 'Qué hace y cuándo usarla.',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  async execute(args, ctx) {
    return `Recibí: ${args.text}`;
  },
};
```

## Estructura

```
src/
  config/        env.ts (variables de entorno)
  db/            pool.ts (SQLite), init.ts (esquema + migraciones), repositories/ (todas
                 scopeadas por user_id excepto habit_logs, que hereda el scope de su todo)
  whatsapp/      wa-manager.ts (sesión Baileys, captura de lid) + bot-manager.ts (resuelve
                 usuario por jid/lid, controla acceso, enruta al agente)
  agent/         provider.ts, ai-agent.ts, tool-registry.ts, routine-setup.ts (rutina + sus
                 2 recordatorios), tools/
  audio/         ffmpeg.ts (conversión), stt.ts (Vosk), tts.ts (Piper) - todo local, sin IA
  fashion/       Fashion Mode (armario/outfits) - aislado del resto: router.ts + flows/ (máquina
                 de estados por chat, sin IA), taxonomy.ts (categorías controladas), storage/
                 (DigitalOcean Spaces), vision/ (llama al microservicio Python de vision-service/)
  scheduler/     task-scheduler.ts (recordatorios, con recurrencia, cruza todos los usuarios)
  server/        API Express + panel + auth (cada request se resuelve a su propio usuario por token)
  util/          fechas (datetime.ts), jid.ts, human-delay.ts (pausa "escribiendo")
admin-panel/     panel admin (React + Vite + Tailwind), compila a public/
public/          estatico servido por Express (build del panel)
vision-service/  microservicio Python separado (Fashion Mode) - clasificación de fotos por CLIP,
                 local y gratis, ver vision-service/README.md
deploy/          scripts individuales que deploy.sh orquesta (Node, systemd, audio, visión)
deploy.sh        despliegue completo en un solo comando, ver "Despliegue en servidor" más abajo
data/            app.db (SQLite, no se sube al repo)
models/          modelo de Vosk + voces de Piper (no se sube al repo, ver sección Audio)
bin/             binario de Piper si lo instalaste con el script de deploy (no se sube al repo)
```

## Despliegue en servidor (Linux)

El proceso debe quedar corriendo 24/7 (mantiene la sesión de WhatsApp y el scheduler de
recordatorios), así que en servidor se usa un supervisor de procesos en vez de `npm run start`
suelto.

### La forma rápida: `./deploy.sh`

Un solo script hace todo - primera vez y cada actualización siguiente, siempre el mismo comando:

```bash
# Primera vez:
git clone https://github.com/Frankma0117/canix.git /opt/canix
cd /opt/canix
./deploy.sh

# Cada actualización futura, siempre lo mismo:
cd /opt/canix
./deploy.sh
```

Qué hace: instala Node 20+ si falta, `git pull`, `npm ci` (backend y panel admin), build del
panel, copia `.env.example` a `.env` si no existe, aplica migraciones (`npm run db:init`),
transcripción/voz local (Vosk + Piper), el microservicio de visión de Fashion Mode (CLIP), y
(re)inicia el bot - detecta solo si ya lo tenés corriendo con PM2 o systemd y usa ese mismo, o si
es la primera vez lo deja andando con PM2 (más simple para empezar). Al final imprime estado y
logs recientes (ahí sale el QR de WhatsApp la primera vez).

**Un solo comando cubre todo de ahora en adelante** - no hace falta acordarse de flags ni correr
scripts sueltos, `./deploy.sh` ya los encadena todos (audio y visión incluidos).

Es **idempotente y no destructivo a propósito**: nunca toca `.env`, `data/` ni `auth_info/`, y si
encuentra cambios sin commitear en el repo del servidor se detiene ANTES de hacer `git pull` en vez
de arriesgarse a pisarlos. Volver a correrlo no reinstala ni redescarga nada que ya esté listo.

Flags opcionales, para saltarte alguna parte (podés agregarlos en cualquier corrida):

```bash
./deploy.sh --no-audio       # todo menos transcripción/voz local (Vosk + Piper)
./deploy.sh --no-vision      # todo menos el microservicio de visión de Fashion Mode
./deploy.sh --minimal        # ninguno de los dos (el deploy mínimo de antes)
```

**Importante**: `deploy.sh` hace `git pull`, así que solo despliega lo que ya esté pusheado a
GitHub - si acabás de terminar cambios en tu máquina, primero `git push`.

Por debajo, `deploy.sh` reusa los scripts individuales de `deploy/*.sh` (`ubuntu-01-setup-node.sh`,
`ubuntu-04-setup-audio.sh`, `ubuntu-05/06-setup-vision*.sh`, etc.) - siguen ahí y siguen sirviendo
sueltos si preferís correr un paso a mano o entender exactamente qué hace cada uno; las siguientes
dos secciones documentan lo que `deploy.sh` termina haciendo automáticamente.

### Opción A: PM2 (manual)

```bash
# En el servidor (Node 20+ instalado):
git clone <tu-repo> /opt/canix   # o sube los archivos por scp/rsync
cd /opt/canix
npm install
cd admin-panel && npm install && npm run build && cd ..
cp .env.example .env && nano .env   # completa AI_API_KEY, etc.

npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # sigue las instrucciones que imprime para que arranque solo tras reiniciar el servidor
```

- `pm2 logs cania` para ver los logs (ahí aparece el QR la primera vez, y el token del panel).
- `pm2 restart cania` / `pm2 stop cania` para reiniciar o parar.

### Opción B: systemd (manual)

Hay una unidad de ejemplo en `deploy/canix.service`. Ajusta las rutas si tu Node no está en
`/usr/bin` (por ejemplo si usas `nvm`, apunta `ExecStart` al binario completo de `npm`):

```bash
sudo useradd -r -s /bin/false canix        # usuario dedicado (opcional pero recomendado)
sudo mkdir -p /var/log/canix && sudo chown canix:canix /var/log/canix
sudo cp deploy/canix.service /etc/systemd/system/canix.service
sudo systemctl daemon-reload
sudo systemctl enable --now canix
sudo journalctl -u canix -f   # logs en vivo (para escanear el QR la primera vez)
```

### Fashion Mode: microservicio de visión (opcional)

Solo hace falta si vas a activar `FASHION_MODE_ENABLED=true` con clasificación automática de fotos
(el módulo funciona igual sin esto, pero pidiéndote los datos a mano - ver "Fashion Mode" más
abajo). Es un proceso Python aparte, separado del bot de Node. `./deploy.sh` ya hace esto por
defecto (los dos pasos de abajo), o `deploy/vision-quickstart.sh` si el bot ya está desplegado y
solo falta/falló la parte de visión.

```bash
# Despues de ubuntu-02-deploy.sh (necesita /opt/canix ya instalado):
deploy/ubuntu-05-setup-vision.sh          # venv + dependencias + precarga el modelo (revisa RAM libre al final)
sudo deploy/ubuntu-06-setup-vision-service.sh   # lo deja como servicio systemd, arranca solo
```

1. `ubuntu-05-setup-vision.sh` crea el venv en `vision-service/.venv`, instala `torch`/`transformers`
   (puede tardar varios minutos), y precarga el modelo una vez para detectar ahora - no en medio de
   un mensaje real de un usuario - si la descarga falla o si la RAM libre queda muy ajustada
   (imprime `free -h` al final; ver "Uso de RAM" en `vision-service/README.md` si el margen es poco).
2. `sudo ubuntu-06-setup-vision-service.sh` instala `deploy/canix-vision.service`, lo habilita y lo
   arranca. Verifica que responde: `curl http://127.0.0.1:8008/health` → `{"ok":true,"model_ready":true}`.
3. Recién ahí, en `/opt/canix/.env`: `FASHION_MODE_ENABLED=true`, y `sudo systemctl restart canix`.

Si en algún momento el servicio de visión se cae o no arrancó, Fashion Mode no se rompe - solo deja
de clasificar fotos automáticamente y te pregunta el tipo/color/estilo a mano.

- `sudo systemctl restart canix-vision` / `stop` / `sudo journalctl -u canix-vision -f` (logs en vivo).
- Para probarlo en tu máquina Windows antes de tocar el servidor: `vision-service\dev.cmd`.

### Notas para producción

- **QR de WhatsApp**: la primera vez hay que escanearlo desde los logs (`pm2 logs cania` o
  `journalctl -u canix -f`) o desde el panel (`Conexión`). Si ya vinculaste el bot en local,
  puedes copiar la carpeta `auth_info/` completa al servidor para no tener que volver a escanear.
- **No pierdas `data/` ni `auth_info/`** en cada deploy: son el estado persistente (base de
  datos SQLite y sesión de WhatsApp). No los borres ni los excluyas de tus backups.
- **Panel web expuesto públicamente**: si vas a acceder a `http://tu-servidor:3000` desde
  internet, ponlo detrás de un reverse proxy (nginx/Caddy) con HTTPS, y no abras el puerto 3000
  directo en el firewall.
- **Actualizar código**: `./deploy.sh` hace todo esto por vos (pull, dependencias, build del panel,
  migraciones, reinicio). A mano sería: `git pull`, `npm ci`, `cd admin-panel && npm ci && npm run
  build && cd ..`, `npm run db:init`, y `pm2 restart cania` / `sudo systemctl restart canix`.

## Reconexión de WhatsApp (sin reiniciar el servidor)

La página **Conexión** del panel tiene un botón **"Reconectar"** que vuelve a intentar la
conexión sin reiniciar el proceso de Node. Antes, la única forma de recuperar una sesión caída
tras agotar los reintentos automáticos era reiniciar todo el servidor.

- Si la conexión se cae por una razón transitoria (red, timeout del servidor de WhatsApp), el
  bot reintenta solo unas pocas veces con backoff exponencial (`MAX_RECONNECT_ATTEMPTS` en
  `src/whatsapp/wa-manager.ts`); si se agotan, queda esperando a que pulses "Reconectar".
- Si WhatsApp responde **403 (forbidden)**, el bot **no reintenta automáticamente**: es la
  misma señal que suele preceder a un bloqueo/restricción del número, y reintentar en bucle es
  justo el patrón que empeora un bloqueo. El panel muestra un aviso ("Posible bloqueo") y las
  credenciales se conservan (no se borra `auth_info/`, no hace falta un QR nuevo). Antes de
  pulsar "Reconectar" en ese caso, abre WhatsApp en el teléfono y confirma que la cuenta no
  aparece bloqueada o limitada.
- El bot nunca abre dos sockets a la vez sobre la misma sesión (evita el escenario de dos
  conexiones simultáneas peleando por el mismo número, otra causa común de bloqueos).
- Si el número quedó bloqueado/restringido y no quieres esperarlo, el botón **"Usar otro
  número"** descarta la sesión guardada (`auth_info/<WA_SESSION>`) y muestra un QR nuevo al
  instante para vincular un número distinto — no afecta al número anterior, solo deja de estar
  conectado a este bot. Es una acción manual y deliberada (endpoint `POST
  /api/connection/new-number`, método `WaManager.useNewNumber()`); nunca se dispara sola, porque
  descartar/re-vincular sesiones automáticamente sería el mismo patrón de churn que causa
  bloqueos.

## Cómo evitar que WhatsApp bloquee/restrinja el número

Baileys es una librería no oficial (usa el protocolo de WhatsApp Web reimplementado), así que
**siempre existe cierto riesgo** de que WhatsApp la detecte y limite el número. Estas prácticas
reducen mucho ese riesgo:

1. **No reintentes conexión de forma agresiva.** Ya está resuelto en el código (ver arriba),
   pero si editas `wa-manager.ts` no bajes el backoff ni quites el freno del 403 solo para
   "que reconecte más rápido" — es exactamente lo que causa bloqueos.
2. **Nunca corras dos instancias del bot con la misma sesión** (`auth_info/<WA_SESSION>`) a la
   vez, ni en dos máquinas ni con `pm2 start` duplicado. Dos sockets peleando por el mismo
   número es una señal fuerte de comportamiento anómalo para WhatsApp.
3. **No re-escanees el QR innecesariamente.** Cada escaneo nuevo reemplaza el "linked device"
   anterior; hacerlo seguido (por ejemplo, borrando `auth_info/` cada vez que algo falla en vez
   de dejar que reconecte) genera un patrón de churn que WhatsApp también vigila.
4. **"Caliente" el número gradualmente si es nuevo.** No lo uses para mandar muchos mensajes o
   a muchos contactos distintos el primer día. Empieza con tu propio número (dueño) y ve
   aumentando el uso en días sucesivos.
5. **Evita mensajes masivos o a números que no te tienen guardado.** Este bot solo responde a
   su dueño y usa `send_message` para contactos que tú mismo guardaste — no lo uses para
   reenviar el mismo mensaje a muchos contactos en poco tiempo ni para escribirle en frío a
   gente que no te tiene agendado (eso es lo que suele generar reportes de spam).
6. **Evita enlaces acortados o de dominios poco confiables** en los mensajes que el bot envía;
   WhatsApp analiza URLs y los acortadores/dominios con mala reputación aumentan el riesgo de
   marca de spam.
7. **Mantén el teléfono con el WhatsApp vinculado activo** (con internet de vez en cuando,
   batería, sesión no cerrada manualmente desde el teléfono). Aunque el modo multi-dispositivo
   no exige que esté siempre online, revisa periódicamente que siga apareciendo como "vinculado"
   en el teléfono.
8. **Preferí un número que ya tenga historial normal de uso** (chip usado, con contactos y
   conversaciones previas) en vez de un SIM recién activado y usado solo para este bot — los
   números nuevos sin historial son los más vigilados.
9. **Si ves un 403 o el panel marca "Posible bloqueo"**, no lo reintentes en bucle manualmente:
   espera unos minutos/horas, revisa el estado en la app oficial del teléfono, y solo entonces
   pulsa "Reconectar" una vez.
10. **El bot ya simula una pausa humana antes de responder** (`util/human-delay.ts`, usado en
    `bot-manager.ts`): una pausa corta al "leer" tu mensaje, más un tiempo de "escribiendo…"
    proporcional al largo de la respuesta. Contestar instantáneo a todo es una de las señales que
    delatan un bot automatizado — no lo quites para "que responda más rápido".

## Variables de entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `PORT` | Puerto del panel/API | `3000` |
| `TIMEZONE` | Zona horaria IANA (todo el bot usa esta para "ahora"/"hoy") | `America/Bogota` |
| `MORNING_SUMMARY_TIME` | Hora `HH:mm` de la agenda automática diaria | `06:30` |
| `WEEKLY_REPORT_DAY` | Día del resumen semanal automático (`0`=domingo .. `6`=sábado) | `0` |
| `WEEKLY_REPORT_TIME` | Hora `HH:mm` del resumen semanal automático | `19:00` |
| `AI_PROVIDER` / `AI_MODEL` / `AI_API_KEY` / `AI_BASE_URL` | Config de IA (compatible OpenAI) | — |
| `DB_PATH` | Ruta del archivo SQLite | `./data/app.db` |
| `WA_SESSION` | Nombre de la sesión de Baileys (carpeta en `auth_info/`) | `personal-agent` |
| `ADMIN_TOKEN` | Token del administrador para el panel. Vacío = se genera solo. Cada otro usuario recibe el suyo automáticamente | — |
| `AI_HISTORY_TURNS` | Mensajes pasados que se reenvían como contexto en cada llamada a la IA | `14` |
| `PANEL_URL` | URL pública del panel (opcional, solo para el mensaje de bienvenida a nuevos usuarios) | — |
| `VOSK_MODEL_PATH` | Carpeta del modelo de Vosk (transcripción de audios). Ver sección Audio | `./models/vosk-es` |
| `PIPER_BIN_PATH` | Ruta al binario de Piper (respuesta por voz). Vacío = desactivado | — |
| `PIPER_VOICE_PATH` | Ruta al modelo de voz `.onnx` de Piper | — |
| `FASHION_MODE_ENABLED` | Interruptor del módulo Fashion Mode. En `false`, el bot se comporta exactamente igual que sin este módulo | `false` |
| `FASHION_MAX_IMAGE_SIZE_MB` | Tamaño máximo aceptado para una foto de prenda | `8` |
| `FASHION_MAX_PDF_SIZE_MB` | Tamaño máximo aceptado para un PDF de importación en lote | `15` |
| `FASHION_MAX_PDF_IMAGES` | Tope de fotos procesadas de un mismo PDF | `12` |
| `DO_SPACES_ENDPOINT` / `DO_SPACES_REGION` / `DO_SPACES_BUCKET` | Config de DigitalOcean Spaces (fotos de prendas) | — |
| `DO_SPACES_ACCESS_KEY_ID` / `DO_SPACES_SECRET_ACCESS_KEY` | Credenciales de Spaces — el secret NUNCA va en el código ni se comparte | — |
| `FASHION_VISION_SERVICE_URL` | URL del microservicio local de visión (ver `vision-service/README.md`) | `http://127.0.0.1:8008` |
| `FASHION_VISION_TIMEOUT_MS` | Timeout de la llamada al servicio de visión antes de caer a clasificación manual | `15000` |
| `FASHION_VISION_MIN_CONFIDENCE` | Confianza mínima para aceptar un campo detectado automáticamente | `0.35` |

## Roadmap (ideas para seguir creciendo)

Notificaciones proactivas de rutinas no marcadas al final del día, resumen diario automático por
WhatsApp, recordatorios basados en ubicación, categorías con colores/iconos en el panel,
exportar/backup del `.db`.
