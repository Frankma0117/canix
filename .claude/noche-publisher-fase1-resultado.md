# Resultado: Publicador, Fases 1 y 2 (2026-11-13)

## Hecho
- **Fase 1:** esquema `publisher_*` (marca, conexiones con tokens cifrados, publicaciones, destinos por red, intentos, ajustes); cola con job cada minuto, reintentos (2, 4, 8… min, 5 intentos) y estados published/partial/failed; SEO por red (IA o plantilla); API `/api/admin/publisher/*`; panel «Publicador» (Cola, Nueva, Marca, Cuentas); proveedor simulado.
- **Fase 2:** generación de imágenes/videos desde el panel sobre `services/promo/` con tope mensual (`generation_cap`, 30 por defecto) y flujo generar → aprobar → SEO → programar.
- Pruebas con BD temporal (script del scratchpad): OK. `npm run typecheck` y `npm run build`: OK.
- Commit: «Publicador de contenido para redes…». Doc: `docs/PUBLISHER.md` (incluye cómo copiarlo a otros proyectos).

## Falta
- Conectores reales: YouTube (fase 3), Instagram/Facebook (4), TikTok (5). Requieren apps y revisiones de Google, Meta y TikTok.
- Portar el módulo a Brindix y demás proyectos (fase 6, siguiendo `docs/PUBLISHER.md`).
- UI para cambiar el tope mensual (hoy solo `PUT /api/admin/publisher/settings`).
- Probar el panel en navegador a 390 px y en oscuro (solo se verificó typecheck/build).
- No desplegado.

## Notas
- Al terminar había cambios ajenos sin commitear en `backend/src/services/promo/*`, `entities/promo.entity.ts`, `audio/voices.ts`, `frontend/public/promo/*`, `backend/scripts/`; no se incluyeron en el commit.
- Las tareas programadas de las 11:55 p. m. y 5:03 a. m. se cancelaron porque se ejecutó ya.

## Archivos clave
`backend/src/services/publisher/*`, `backend/src/api/routes/publisher.routes.ts`, `backend/src/database/schema/publisher.schema.ts`, `frontend/src/pages/admin/PublisherPage.tsx`, `frontend/src/components/organisms/publisher/*`.
