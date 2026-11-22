# Notas: línea única de videos (Canix, Brindix, Aula) — 2026-11-22

Plan base: estrategia TomaPedidos (conocimiento-videos-Tomapedidos) adaptada. Motor elegido: escenario HTML + Playwright + ffmpeg (el de `services/promo`), NO Remotion (licencia).

## Hecho (Canix, sin commit ni deploy; typecheck OK)
- `promo-qa.ts`: control de calidad automático (teléfonos, puntos suspensivos en la voz, emojis, escena <0,8 s, gancho/cierre, duración) + `cleanSay`.
- `promo-build.ts`: caché de voz por hash (voz+texto) → regrabar solo paga lo que cambió; guarda `qa`; conserva la versión anterior (`content.prev`) y borra la anterior a esa; aplica `content.change` (cambio en palabras) con el LLM sobre el guion actual.
- `promo.service.ts` `redrawVideo` + ruta `POST /api/admin/promo/:id/revise` ({scenes[{text,say,items}], instruction, voice}); historial `content.revisions`.
- `PromoCard.tsx`: editor de guion por escena, "pedir cambio con tus palabras", avisos de QA, versiones y ver versión anterior.

## Hecho 2026-11-22 (voz)
- Canix: vista previa con la voz ya grabada (solo escenas sin editar) y música; voz por defecto con grupo «★ recomendadas» (narradora M5/M3/M8/M6, locutor H14/H4/H12/H19) en PromoPage; cambio de voz por video (`/revise {voice}`) en PromoCard. typecheck OK.
- Brindix (`platform/videos.component.ts`): ★ recomendadas primero y «Usar esta voz siempre» (guardada en localStorage del navegador, no compartida; defecto M5). SIN compilar (no hay node_modules local): correr `ng build` antes de desplegar.
- Aula: ya tenía voz por defecto guardada + escuchar (`pages/admin/videos.js`); falta ★ recomendadas y vista previa con voz.

## Desplegado 2026-11-22
- Canix: commit 53dc180, push y deploy OK (servicio activo, /promo/stage.html con SAMEORIGIN). Ojo: NO lanzar dos `deploy.sh` a la vez (ENOTEMPTY en node_modules); si el ssh se corta, esperar a que termine el del servidor.
- Brindix: voces ★ + voz por defecto sobre origin/main (rama `voces-marca`, commit 1a3a509), compilado con `ng build` y desplegado. El checkout local de brindix está en la rama `publicador` (hay commits 29e0690 duplicado, ignorar).

## Falta (en este orden)
1. Probar en local: crear un video, editar una escena, pedir un cambio; revisar. Luego `/code-review low`, commit y deploy (skill deploy-canix). `confirm()` del botón Eliminar en PromoCard viola la regla «sin confirm()»: cambiar por diálogo propio.
2. HECHO (sin probar en navegador): `StagePreview.tsx` (iframe de stage.html, `content.stage` guardado al grabar; cabeceras frame de `/promo/stage.html` relajadas en security.middleware). Los videos ya creados no tienen `content.stage` hasta regrabarlos.
3. `brand.json` por proyecto (colores, fuentes, logo, cierres por público, voz, música, zonas seguras, prohibidos) leído por el escenario y por el QA.
4. Extraer `video-kit` (repo propio `d:\video-kit`, se copia a cada proyecto como publisher-app): stage + plantillas + pipeline voz/música/ffmpeg + QA.
5. Plantillas nuevas: tutorial 16:9 (etiqueta de paso, ruta de menú, contorno naranja, cierre tutorial) y guía PDF (HTML→PDF con Playwright), todo desde el mismo storyboard JSON (reel + tutorial + guía).
6. Biblioteca de capturas automáticas por proyecto (cuenta demo, fecha, tapar datos, «Datos de ejemplo»).
7. Migrar Aula (`backend/app/integrations/video_render.py`, Python) y Brindix (`studio/`, Python; conserva labios y música por estilo) al kit; retirar `cania-web/scripts/videos/make.py`.
8. Enviar el video aprobado a «Por validar» del publicador de cada panel.

Decisiones tomadas por defecto (confirmar): motor HTML+Playwright; kit como repo propio copiado.
