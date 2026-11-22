# Notas: línea única de videos (Canix, Brindix, Aula) — 2026-11-22

Plan base: estrategia TomaPedidos (conocimiento-videos-Tomapedidos) adaptada. Motor elegido: escenario HTML + Playwright + ffmpeg (el de `services/promo`), NO Remotion (licencia).

## Hecho (Canix, sin commit ni deploy; typecheck OK)
- `promo-qa.ts`: control de calidad automático (teléfonos, puntos suspensivos en la voz, emojis, escena <0,8 s, gancho/cierre, duración) + `cleanSay`.
- `promo-build.ts`: caché de voz por hash (voz+texto) → regrabar solo paga lo que cambió; guarda `qa`; conserva la versión anterior (`content.prev`) y borra la anterior a esa; aplica `content.change` (cambio en palabras) con el LLM sobre el guion actual.
- `promo.service.ts` `redrawVideo` + ruta `POST /api/admin/promo/:id/revise` ({scenes[{text,say,items}], instruction, voice}); historial `content.revisions`.
- `PromoCard.tsx`: editor de guion por escena, "pedir cambio con tus palabras", avisos de QA, versiones y ver versión anterior.

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
