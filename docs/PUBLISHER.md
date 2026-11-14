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
| 6 | Portar el módulo a Brindix y demás proyectos | Pendiente |

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
