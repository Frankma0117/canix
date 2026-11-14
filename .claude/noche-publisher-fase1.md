# Noche: Publicador de contenido, Fase 1 (Canix)

## Objetivo
Crear un módulo autocontenido `publisher` en `backend/src` (y su panel en `frontend/`) para programar y publicar videos/imágenes en redes. Debe poder copiarse luego a Brindix y a otros proyectos cambiando solo la configuración (cada proyecto con sus propias cuentas y API keys).

## Alcance (solo Fase 1)
1. **Migración** (en `backend/src/database`): tablas para
   - perfil de marca (tono, hashtags base, idioma, palabras clave, cuentas por plataforma),
   - conexiones por plataforma con tokens OAuth **cifrados** (usar el mecanismo de cifrado ya existente en el proyecto; si no hay, AES-256-GCM con clave de `.env`; nunca imprimir `.env` ni secretos),
   - cola de publicaciones (activo/media, plataformas, título, descripción, hashtags, miniatura, `scheduled_at`, estado: borrador/programada/publicando/publicada/fallida, reintentos),
   - registro de intentos con errores.
2. **Interfaz de proveedor** `PublisherProvider` (connect, publish, status) y un **proveedor simulado** que funcione de extremo a extremo. NO implementar YouTube/Instagram/Facebook/TikTok reales.
3. **Cola y programación**: job en `src/jobs` que toma publicaciones vencidas, publica con el proveedor, reintenta con backoff y registra errores.
4. **SEO con LLM** (el agente/LLM compatible OpenAI ya existente): genera por plataforma título, descripción, hashtags y palabras clave usando el perfil de marca.
5. **API** en `src/api` (Express): CRUD de perfil de marca, conexiones, publicaciones; acción "generar SEO"; "publicar ahora" y "programar". Respetar la autenticación y roles existentes.
6. **Integración con "Videos y publicidad"** (commit f8f565c): reutilizar la generación de imágenes y videos existente como fuente de activos para publicar. Las acciones con costo son **permisos facturables, fuera de los paquetes** (seguir el patrón existente de permisos).
7. **Panel** en el portal/admin del frontend (React + Vite): perfil de marca, conexiones, cola/calendario, editor de publicación con SEO sugerido, estado y errores.
8. Documentar en `docs/FEATURES.md` y `docs/API.md` (breve) y cómo copiar el módulo a otro proyecto.

## Reglas
- Código e identificadores en inglés; texto visible en español. Asistente = **Canix**.
- Sin `confirm()/prompt()/alert()`. Diseño según skills impeccable + Emil (movimiento); móvil primero.
- Node 20: `PATH="/c/Users/Asus/node20:$PATH"` en Bash.
- Pruebas que usen la BD: contra una BD **temporal**, nunca `data/app.db`.
- Heredocs largos fallan en Bash: escribe scripts al scratchpad y ejecútalos.
- Ediciones puntuales, lecturas mínimas (Grep/Glob primero).

## NO tocar
- `data/`, `auth_info/`, `.env`, servidor de producción. **No desplegar**, sin ssh ni sudo.
- Otros proyectos (Brindix, etc.) en esta fase.
- Stickers, flujo de encuestas, ni lógica de WhatsApp existente.

## Terminado cuando
- `npm run typecheck` pasa y `npm run build` compila.
- Prueba con BD temporal: crear perfil, generar SEO (o stub si no hay LLM), programar una publicación y verla publicada con el proveedor simulado.
- Commit en español (skill `commit`).

## Al final
Escribe `.claude/noche-publisher-fase1-resultado.md` con: **Hecho / Falta / Errores / Archivos clave** (notas para retomar con "continúa con las notas").
