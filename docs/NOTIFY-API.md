# API de mensajes y aprobaciones de Canix

Canix es el mensajero de tus otros proyectos (Brindix, una landing, maniksero…): le escriben a Canix y Canix te avisa por WhatsApp. También pueden **pedirte una aprobación**: te llega el mensaje (con imagen si hay), la respondes con 👍 / 👎 o con un **enlace** que se abre en cualquier celular, y la respuesta vuelve al proyecto.

Panel: **Plataforma → Sistema → Proyectos conectados** (crea la llave, el secreto del webhook y mira el registro). Código: `backend/src/services/notify/`, `api/routes/notify.routes.ts`.

## Conectar un proyecto
1. Panel → Proyectos conectados → **Conectar un proyecto**: nombre y, si quieres, la dirección (https) de su webhook.
2. Se muestran **una sola vez**: la llave (`cnx_…`) y el secreto del webhook (`whsec_…`). Pégalos en el `.env` del proyecto:
   `CANIX_URL=https://canix.cania.app` · `CANIX_API_KEY=cnx_…` · `CANIX_WEBHOOK_SECRET=whsec_…`
3. Canix guarda solo el hash de la llave y el secreto cifrado. Si se pierden: «Nueva llave» / «Nuevo secreto». Un proyecto se puede desactivar o borrar sin tocar a los demás.

## Endpoints (llave en `Authorization: Bearer cnx_…`)
Límite: 30 solicitudes por minuto por llave; máximo 25 aprobaciones sin responder por proyecto.

**Mensaje simple** — `POST /api/v1/messages`
```json
{ "title": "Pedido nuevo", "text": "Mesa 4 pidió 2 cervezas", "imageUrl": "https://…/foto.jpg" }
```
→ `201 { "id": 12, "status": "sent" }`. `text` es obligatorio (máx. 1500); `title` e `imageUrl` (https) son opcionales.

**Pedir una aprobación** — `POST /api/v1/approvals`
```json
{ "title": "Publicar la promo del viernes", "text": "2x1 en cervezas", "imageUrl": "https://…/promo.jpg", "ref": "post-42", "expiresInMinutes": 1440 }
```
→ `201 { "id": 13, "status": "pending", "link": "https://canix.cania.app/a/…", "expiresAt": "…" }`
- `title` obligatorio. `ref` es **tu** referencia: vuelve tal cual en la respuesta. `expiresInMinutes`: 5 a 10 080 (por defecto 1440 = 24 h).
- El WhatsApp dice «👍 aprobar · 👎 rechazar · o confirma aquí: <enlace>». **La primera respuesta gana** (reacción o enlace); las demás no cambian nada.
- El enlace abre una página de una sola decisión (no se indexa, no se guarda en caché).

**Consultar una aprobación** — `GET /api/v1/approvals/:id` → `{ "id", "status": "pending|approved|rejected|expired", "ref", "decidedVia": "reaction|link|null", "decidedAt", "expiresAt" }`. Sirve si no quieres usar webhook.

## Webhook (la respuesta vuelve al proyecto)
Cuando la aprobación se decide (o vence), Canix hace `POST` a la dirección del webhook:
```json
{ "event": "approval.decided", "id": 13, "ref": "post-42", "status": "approved", "decidedVia": "link", "decidedAt": "2026-11-14T15:02:11Z", "project": "Brindix" }
```
Cabeceras: `X-Canix-Event`, `X-Canix-Timestamp` (segundos), `X-Canix-Signature: sha256=<HMAC-SHA256(secreto, "<timestamp>.<cuerpo>")>`.
- **Verifícala siempre** con el cuerpo **crudo** y rechaza marcas de tiempo de hace más de 5 minutos.
- Responde `2xx`. Si no, Canix reintenta a 1, 2, 5, 15, 60 y 180 minutos (6 intentos) y lo marca como fallido en el panel.
- Puede llegar más de una vez: usa `id` para no procesarlo dos veces. `status: "expired"` llega cuando nadie respondió a tiempo.

Ejemplo (Node/Express) — la función ya existe en el módulo del publicador (`publisher/canix-client.ts`):
```ts
app.post('/api/canix/respuesta', express.raw({ type: 'application/json' }), async (req, res) => {
  const raw = req.body.toString('utf8');
  if (!verifyCanixWebhook(process.env.CANIX_WEBHOOK_SECRET!, req.headers, raw)) return res.sendStatus(401);
  const { ref, status } = JSON.parse(raw);
  await handleApprovalDecision(ref, status); // del publicador; o tu propia lógica con `ref`
  res.sendStatus(200);
});
```

## Usarla desde el publicador de otro proyecto
El publicador (`docs/PUBLISHER.md`) aprueba por WhatsApp en Canix. En Brindix y los demás, que no tienen WhatsApp propio, se conecta así al portar el módulo:
```ts
import { createCanixHost } from './services/publisher/canix-client.js';
setPublisherHost(createCanixHost({ url: process.env.CANIX_URL!, apiKey: process.env.CANIX_API_KEY!, adminId: () => 1 }));
```
y se añade la ruta del webhook de arriba. Desde ese momento, cada pieza por aprobar llega a **tu WhatsApp** (con la imagen y el enlace), la apruebas con 👍 o con el enlace, y el publicador de ese proyecto la programa.

## Seguridad
- La llave solo vive en el servidor del proyecto; nunca en el navegador.
- Canix solo escribe **al administrador**: el destinatario no se puede elegir desde la API.
- Los enlaces de aprobación son únicos (192 bits), de un solo uso y vencen; el webhook va firmado y con marca de tiempo.
- Rotar la llave invalida la anterior al instante.
