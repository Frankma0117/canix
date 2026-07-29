# canix 🗂️

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
- 🌅 **Agenda del día**: cada mañana (hora configurable, `MORNING_SUMMARY_TIME`) te llega
  automáticamente el orden del día completo - rutinas, recordatorios y tareas de hoy, empezando
  por lo primero. Pregúntalo en cualquier momento ("¿qué tengo hoy?", "¿cómo va mi día?") y también
  te dice qué rutina ya pasó de hora sin marcarse, para que la reprogrames el mismo día si quieres.
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
  premios/castigos, recordatorios y contactos — siempre sobre tus propios datos como admin (el
  panel es solo tuyo; el resto de usuarios interactúan solo por WhatsApp).

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
- El panel web queda en **http://localhost:3000** (token de acceso impreso en consola, o defínelo
  en `ADMIN_TOKEN`).
- El **primer número que le escriba al bot** por WhatsApp queda registrado como **administrador**.
  Desde ahí puedes darle acceso a otras personas con `grant_access` — ver "Multi-usuario" abajo.

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
- **Ver quién tiene acceso**: *"¿quién tiene acceso al bot?"* (`list_users`).
- El panel web (`admin-panel/`) siempre muestra y edita **los datos del administrador** — el resto
  de usuarios solo interactúan por WhatsApp, no tienen acceso al panel.

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
deploy/ubuntu-04-setup-audio.sh
```

Descarga el modelo de Vosk en español, el binario de Piper (última versión, linux x64) y una voz
en español, todo en `/opt/canix/models` y `/opt/canix/bin` — al final imprime las 3 líneas que hay
que agregar a `.env`. Seguro de re-correr (omite lo que ya esté descargado).

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
  scheduler/     task-scheduler.ts (recordatorios, con recurrencia, cruza todos los usuarios)
  server/        API Express + panel + auth (panel siempre opera sobre el usuario admin)
  util/          fechas (datetime.ts), jid.ts, human-delay.ts (pausa "escribiendo")
admin-panel/     panel admin (React + Vite + Tailwind), compila a public/
public/          estatico servido por Express (build del panel)
data/            app.db (SQLite, no se sube al repo)
models/          modelo de Vosk + voces de Piper (no se sube al repo, ver sección Audio)
bin/             binario de Piper si lo instalaste con el script de deploy (no se sube al repo)
```

## Despliegue en servidor (Linux)

El proceso debe quedar corriendo 24/7 (mantiene la sesión de WhatsApp y el scheduler de
recordatorios), así que en servidor se usa un supervisor de procesos en vez de `npm run start`
suelto. Dos opciones, cualquiera de las dos sirve:

### Opción A: PM2

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

- `pm2 logs canix` para ver los logs (ahí aparece el QR la primera vez, y el token del panel).
- `pm2 restart canix` / `pm2 stop canix` para reiniciar o parar.

### Opción B: systemd

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

### Notas para producción

- **QR de WhatsApp**: la primera vez hay que escanearlo desde los logs (`pm2 logs canix` o
  `journalctl -u canix -f`) o desde el panel (`Conexión`). Si ya vinculaste el bot en local,
  puedes copiar la carpeta `auth_info/` completa al servidor para no tener que volver a escanear.
- **No pierdas `data/` ni `auth_info/`** en cada deploy: son el estado persistente (base de
  datos SQLite y sesión de WhatsApp). No los borres ni los excluyas de tus backups.
- **Panel web expuesto públicamente**: si vas a acceder a `http://tu-servidor:3000` desde
  internet, ponlo detrás de un reverse proxy (nginx/Caddy) con HTTPS, y no abras el puerto 3000
  directo en el firewall.
- **Actualizar código**: `git pull` (o subir los archivos nuevos), `npm install` si cambiaron
  dependencias, `cd admin-panel && npm install && npm run build && cd ..` si cambió el panel, y
  `pm2 restart canix` / `sudo systemctl restart canix`.

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
| `AI_PROVIDER` / `AI_MODEL` / `AI_API_KEY` / `AI_BASE_URL` | Config de IA (compatible OpenAI) | — |
| `DB_PATH` | Ruta del archivo SQLite | `./data/app.db` |
| `WA_SESSION` | Nombre de la sesión de Baileys (carpeta en `auth_info/`) | `personal-agent` |
| `ADMIN_TOKEN` | Token de acceso al panel. Vacío = se genera solo | — |
| `VOSK_MODEL_PATH` | Carpeta del modelo de Vosk (transcripción de audios). Ver sección Audio | `./models/vosk-es` |
| `PIPER_BIN_PATH` | Ruta al binario de Piper (respuesta por voz). Vacío = desactivado | — |
| `PIPER_VOICE_PATH` | Ruta al modelo de voz `.onnx` de Piper | — |

## Roadmap (ideas para seguir creciendo)

Notificaciones proactivas de rutinas no marcadas al final del día, resumen diario automático por
WhatsApp, recordatorios basados en ubicación, categorías con colores/iconos en el panel,
exportar/backup del `.db`.
