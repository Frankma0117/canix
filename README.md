# canix 🗂️

Asistente personal por WhatsApp: recordatorios, una biblioteca de links clasificados por
categorías, tareas (de hoy, para después o rutinas) y seguimiento de hábitos. Es un proyecto
**de un solo usuario** (tú), con la misma arquitectura que
[estylia](../estylia) (Baileys + agente de IA con tools + scheduler), simplificada para uso
personal: sin multi-negocio, con SQLite en vez de MySQL.

## Características

- ⏰ **Recordatorios**: "recuérdame X en 5 minutos", "el 15 de agosto a las 9am", "todos los
  lunes a las 8am". Soportan repetición (diaria/semanal/mensual/anual) y se pueden enviar a ti
  o a un contacto guardado.
- 🔗 **Links por categoría**: le envías un link por WhatsApp y el bot te pregunta en qué
  categoría guardarlo y una breve descripción antes de guardarlo. Las categorías las creas tú
  (por chat o desde el panel).
- 🎲 **Consultar una categoría**: "dame algo de comidas" te sugiere un link al azar de esa
  categoría (prioriza los que no has usado hace tiempo).
- 🗑️ **Eliminar links**: le pides borrar uno, el bot lo busca y confirma antes de eliminarlo.
- ✅ **Tareas**: "hoy" (solo para el día), "para después" (sin fecha fija) y "rutinas" (hábitos
  recurrentes con seguimiento diario/semanal y racha).
- 💬 **Enviar mensajes**: "envíale un mensaje a Juan diciéndole que..." — busca el contacto
  guardado y lo envía por WhatsApp.
- 📊 **Panel web** (`admin-panel/`): ver/editar categorías, links, tareas, rutinas (con racha),
  recordatorios y contactos, además del estado de conexión de WhatsApp con su QR.

## Diferencias importantes con estylia

- **Un número dedicado para el bot** (no tu WhatsApp personal): vincula un número aparte (chip
  extra, WhatsApp Business, etc.) y escríbele desde tu WhatsApp de siempre. La primera persona
  que le escribe queda registrada como su **dueño** — solo esa persona puede usarlo; cualquier
  otro número recibe una respuesta genérica.
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
- El **primer número que le escriba al bot** por WhatsApp queda registrado como su dueño. Solo
  ese número puede usarlo de ahí en adelante.

## Ejemplos de uso (por WhatsApp)

- "Recuérdame llamar al dentista mañana a las 10am"
- "Todos los días a las 7am recuérdame tomar la pastilla"
- Enviar un link → el bot pregunta categoría y descripción → queda guardado
- "Dame algo de la categoría películas"
- "Elimina el link de [tema]"
- "Agrega a mis pendientes de hoy: pagar el arriendo"
- "Crea una rutina de ejercicio diaria"
- "Ya hice ejercicio hoy" (marca el check-in del día)
- "¿Qué tengo pendiente hoy?"
- "Envíale un mensaje a Ana diciéndole que llego en 10 minutos"

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
  db/            pool.ts (SQLite), init.ts (esquema), repositories/
  whatsapp/      wa-manager.ts (sesión Baileys) + bot-manager.ts (resuelve dueño, enruta al agente)
  agent/         provider.ts, ai-agent.ts, tool-registry.ts, tools/
  scheduler/     task-scheduler.ts (recordatorios, con recurrencia)
  server/        API Express + panel + auth
  util/          fechas (datetime.ts), jid.ts
admin-panel/     panel admin (React + Vite + Tailwind), compila a public/
public/          estatico servido por Express (build del panel)
data/            app.db (SQLite, no se sube al repo)
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

## Variables de entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `PORT` | Puerto del panel/API | `3000` |
| `TIMEZONE` | Zona horaria IANA | `America/Bogota` |
| `AI_PROVIDER` / `AI_MODEL` / `AI_API_KEY` / `AI_BASE_URL` | Config de IA (compatible OpenAI) | — |
| `DB_PATH` | Ruta del archivo SQLite | `./data/app.db` |
| `WA_SESSION` | Nombre de la sesión de Baileys (carpeta en `auth_info/`) | `personal-agent` |
| `ADMIN_TOKEN` | Token de acceso al panel. Vacío = se genera solo | — |

## Roadmap (ideas para seguir creciendo)

Notificaciones proactivas de rutinas no marcadas al final del día, resumen diario automático por
WhatsApp, recordatorios basados en ubicación, categorías con colores/iconos en el panel,
exportar/backup del `.db`.
