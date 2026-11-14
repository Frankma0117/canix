# Publicador de contenido

Programa y publica videos e imágenes en las redes del proyecto (YouTube, Instagram, Facebook, TikTok), con SEO por red.
Panel: **Administración → Publicador** (solo administrador). Cada proyecto tiene el suyo, con sus cuentas, su perfil de marca y sus claves.

## Estado por fases
| Fase | Qué | Estado |
|---|---|---|
| 1 | Cola, programación, perfil de marca, tokens cifrados, SEO (IA + plantilla), panel, proveedor simulado | Hecha |
| 2 | Generar imágenes/videos desde el panel con tope mensual (sobre `services/promo/`) | Hecha |
| 3 | Conector YouTube (OAuth + subida reanudable, Data API v3) | Hecha; falta probarla con una cuenta real |
| 4 | Conector Instagram y Facebook (Meta Graph API, un solo inicio de sesión) | Hecha; falta probarla con cuentas reales |
| 5 | Conector TikTok (Content Posting API) | Hecha; falta probarla con una cuenta real |
| 6 | Estudio de marca y automatización (calendario por red) | Hecha |
| 7 | Portar el módulo a Brindix y demás proyectos | Pendiente |

## Piezas (todo en `backend/src/services/publisher/`)
- `publisher.types.ts` — tipos, redes, límites por red e interfaz `PublisherProvider`.
- `publisher.providers.ts` — registro de proveedores: el simulado (`mock`) y marcadores «próximamente».
- `publisher.store.ts` — acceso a las tablas `publisher_*` (esquema en `database/schema/publisher.schema.ts`).
- `publisher.service.ts` — marca, conexiones, publicaciones, reintentos (2, 4, 8… min; 5 intentos) y estado final.
- `publisher-seo.ts` — título, descripción y hashtags por red con el LLM; plantilla si no hay IA.
- `publisher-crypto.ts` — AES-256-GCM para tokens. Clave: `PUBLISHER_SECRET` o, si no existe, `data/publisher.key` (se crea sola).
- `publisher-media.ts` — **único archivo que conoce el origen del material** (en Canix: `services/promo/`).
- `publisher-job.ts` — cada minuto envía lo vencido.
- API: `api/routes/publisher.routes.ts` (`/api/admin/publisher/*`). Panel: `frontend/src/pages/admin/PublisherPage.tsx` y `components/organisms/publisher/`.

## Un proveedor real
Implementa `PublisherProvider` (`connect` y `publish`), regístralo en `publisher.providers.ts` (`available: true`) y asócialo a su red en `REAL_FOR`. La cola, el SEO y el panel no cambian. Las credenciales de cada app (Google, Meta, TikTok) van en el `.env` del proyecto.

## Costos
Generar material cuesta (voz, música, IA). El tope mensual por proyecto se guarda en `publisher_settings` (`generation_cap`, por defecto 30) y se cambia desde la API (`PUT /settings`).
En Canix la generación ya es solo del administrador, así que no es un permiso de paquetes.

## Copiar el módulo a otro proyecto
**Recomendado: el publicador de cada proyecto es una copia de `D:\publisher-app` incrustada en su panel** (modo incrustado: sin otro login ni subdominio, por ticket firmado; los videos que el proyecto genera llegan a «Por validar» y se elige cuál publicar). Ya está hecho en Brindix, Cania Web y Aula Interactiva (ramas `publicador`; cada uno con su `docs/PUBLICADOR.md` y su `scripts/set-publisher.sh`). Guía del motor: `publisher-app/docs/INCRUSTADO.md`. Un arreglo del módulo aquí se porta allá (y al revés) y se vuelve a copiar con `node publisher-app/scripts/vendor.mjs <proyecto>/publisher`.

La copia manual de abajo solo aplica a proyectos Node/TypeScript que quieran integrarlo en su propio código:
1. Copia `services/publisher/`, `database/schema/publisher.schema.ts`, `api/routes/publisher.routes.ts` y, en el frontend, `types/publisher.ts`, `pages/admin/PublisherPage.tsx` y `components/organisms/publisher/`.
2. Registra: `initPublisherSchema` en la migración, `registerPublisherRoutes` en las rutas de admin, `startPublisherJob()` al arrancar y la sección en el menú.
3. Reescribe `publisher-media.ts` (`resolveMedia`, `approvedAssets`, `postFromAsset`, `generateAssets`) con el generador y el almacenamiento del proyecto. Quita de `publisher.routes.ts` lo que no use.
4. El módulo usa del proyecto: `db`, `fromRoot`, `AccessError`, el cliente LLM (`getAiClient`) y `aiUsageModel`. Ajusta esos imports.
5. Perfil de marca, cuentas y claves: propios de cada proyecto, desde su panel.

Pruebas: contra una BD temporal (`DB_PATH=data/test.db`), con `AI_API_KEY=` vacío para no gastar IA.

## Conectar YouTube (una vez por proyecto)
1. En Google Cloud: crea un proyecto, activa **YouTube Data API v3**, configura la pantalla de consentimiento (añade tu cuenta como usuario de prueba) y crea un cliente OAuth de tipo **Aplicación web**.
2. URI de redirección autorizada: `<PANEL_URL>/api/publisher-oauth/callback` (en Canix: `https://canix.cania.app/api/publisher-oauth/callback`).
3. En el `.env` del servidor: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y, si quieres, `YOUTUBE_PRIVACY` (por defecto `private`). Reinicia el servicio.
4. Panel → Publicador → Cuentas → YouTube → **Conectar con Google**.
5. Mientras la app no pase la auditoría de Google, YouTube deja los videos subidos como **privados** aunque se pida público. Pide la auditoría cuando quieras publicar abierto.
6. Cuota: cada subida gasta ~1600 unidades de las 10 000 diarias (unos 6 videos al día).
- La API de YouTube solo recibe videos: una imagen no se puede programar a YouTube (el panel avisa).
- Los tokens se renuevan solos con el refresh token.

## Conectar Instagram y Facebook (Meta)
1. Crea una **página de Facebook** y convierte tu Instagram en cuenta **profesional** (Empresa o Creador); vincúlala a esa página (Configuración de la página → Cuentas vinculadas).
2. En developers.facebook.com crea una app tipo **Empresa** y añade **Facebook Login for Business** (o Inicio de sesión con Facebook). En «URI de redireccionamiento OAuth válidos» pon `<PANEL_URL>/api/publisher-oauth/callback`.
3. Permisos que pide el panel: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management`. En modo desarrollo funcionan con tus propias cuentas (agrégate como administrador o probador de la app); para cuentas de terceros hay que pasar la revisión de Meta.
4. `.env` del servidor: `META_APP_ID`, `META_APP_SECRET` (y `META_PAGE_ID` si administras varias páginas). Reinicia.
5. Panel → Cuentas → Instagram (o Facebook) → **Conectar con Meta**: una sola autorización conecta la página y su Instagram.
- Meta descarga el archivo desde la dirección pública: `PANEL_URL` debe ser https y alcanzable desde internet (en Canix ya lo es).
- Instagram: los videos salen como Reels y las imágenes como publicaciones (JPEG). El video puede tardar unos minutos en procesarse.
- El token de página no caduca; si Meta lo revoca (cambio de contraseña, etc.) el panel marca la red «Con error» y se vuelve a conectar.

## Conectar TikTok
1. En developers.tiktok.com crea una app, añade los productos **Login Kit** y **Content Posting API** (activa *Direct Post*) y registra la URI de redirección `<PANEL_URL>/api/publisher-oauth/callback`.
2. Scopes: `user.info.basic` y `video.publish`. En modo sandbox añade tu cuenta como usuario de prueba.
3. `.env` del servidor: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_PRIVACY` (por defecto `SELF_ONLY`). Reinicia.
4. Panel → Cuentas → TikTok → **Conectar con TikTok**.
- Hasta que TikTok audite la app, todo video se publica **privado** (solo tú). Pide la auditoría cuando quieras publicar abierto.
- Solo videos (MP4). Los tokens se renuevan solos.

## Estudio de marca (Administración → Publicador → Estudio)
Crea el logo, la foto de perfil, las portadas (YouTube 2560×1440 y Facebook 1640×624, con zona segura), las publicaciones (cuadrada y vertical) y las historias/Reels (1080×1920), todo con la identidad del proyecto.
- **Identidad visual** (una por proyecto): 5 colores, tipo de letra (Inter, Playfair, Poppins o Montserrat) y estilo del arte. Se guarda en `publisher_identity`.
- **Cómo se hace una pieza:** textos con el LLM en la voz de la marca (o plantilla sin IA) → arte con un modelo de imagen (fal.ai · FLUX; sin `FAL_KEY`, un degradado de la marca) → el estudio dibuja los textos y el logo encima con un navegador (Chromium) y fotografía el resultado. El modelo **nunca escribe texto**: así no hay faltas de ortografía.
- **Diseños:** Logo con símbolo · Portada con arte · Foto completa con titular · Mitad arte/mitad texto · Consejo con puntos (gratis) · Frase grande (gratis). Los dos «gratis» no usan IA de imagen y sirven para publicar a diario sin gasto.
- **Revisión:** cada pieza espera tu aprobación. Puedes corregir los textos (se redibuja con el mismo arte, sin gastar IA), pedir otra versión, descargar o **publicar** (abre la publicación con su texto y SEO). Un logo aprobado se marca «Usar como logo» y aparece en todas las piezas siguientes.
- **Costo:** solo el arte con IA cuenta contra el tope mensual de piezas (el mismo de los videos).
- **Servidor:** se hace en un proceso hijo de baja prioridad (`studio-worker.ts`); necesita el mismo Chromium que el módulo de publicidad (`deploy/ubuntu-10-setup-promo.sh`). Las fuentes se piden a Google Fonts; sin internet se usa una fuente del sistema.
- Archivos: `services/publisher/studio/` (`studio-art`, `studio-templates`, `studio-compose`, `studio-copy`, `studio-build`, `studio.service`) y `components/organisms/publisher/StudioPanel.tsx`. Para otro proyecto se copian junto con el resto del módulo; solo cambia la identidad.

## Automatización (Administración → Publicador → Automático)
Reglas recurrentes («lunes y jueves 8:00 a. m.: un consejo en Instagram y Facebook») que hacen todo solas.
- **Una regla** tiene: tipo (imagen del estudio o video de publicidad), formato, diseños que se turnan, temas que se turnan (o la IA elige a partir de las palabras clave), redes, días, hora local, anticipación (4–48 h) y modo.
- **Modo «Yo la apruebo»:** unas horas antes de la publicación se crea la pieza y te llega un WhatsApp **con la imagen** (o la portada del video): **👍 la aprueba y la programa, 👎 la omite** (también aparece en «Por aprobar» del panel). Al aprobar se crea la publicación con su SEO por red y queda programada. Solo reacciona el administrador; otro emoji no hace nada. Si nadie la aprueba 6 h después de su hora, se omite (y se avisa).
- **Modo «Automática»:** se crea, se aprueba, se escribe el SEO y se programa sola; el WhatsApp avisa cuando la programó y cuando salió.
- **Siempre se avisa** si algo falla (pieza que no se pudo crear, red desconectada, publicación que falló o salió parcial).
- **Tope del mes:** si se acaba, la regla cambia a los diseños gratis (Consejo / Frase) para no romper el calendario.
- **«Preparar ahora»** crea la próxima sin esperar su ventana, para ver qué sale.
- **Zona horaria:** `publisher_settings.timezone` (por defecto `America/Bogota`; se cambia con `PUT /api/admin/publisher/automation/timezone`). Los cambios de hora de verano se manejan solos.
- **Cómo funciona:** cada minuto el job (`publisher-job.ts`) llama a `automationTick()` (planea las corridas que entran en su ventana y mueve las abiertas) y luego envía lo vencido. Cada corrida (`publisher_runs`) es única por regla y hora: nada se duplica aunque el servidor se reinicie.
- **Avisos y reacciones:** el módulo no conoce WhatsApp. Cada proyecto conecta su canal en `index.ts` con `setPublisherHost({ adminId, notify })` (`notify` devuelve el id del mensaje enviado) y llama a `handlePublisherReaction(targetId, emoji)` desde su manejador de reacciones; sin eso funciona igual, solo que sin avisos y se aprueba en el panel.
- Archivos: `services/publisher/automation/` (`automation.service`, `.store`, `.host`, `automation-time`) y `components/organisms/publisher/AutomationPanel.tsx`.
