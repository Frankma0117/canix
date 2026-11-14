# Noche: Publicador, Fase 2 (imágenes y videos por proyecto) — Canix

## Antes de empezar
Lee `.claude/noche-publisher-fase1-resultado.md`. Si la Fase 1 quedó incompleta o con errores, termínala primero (typecheck y build deben pasar) y luego sigue.

## Objetivo
Cada proyecto debe tener generación de imágenes y de videos integrada al publicador, con el estilo de su marca. Construir sobre el módulo existente "Videos y publicidad" (commit f8f565c), sin duplicarlo.

## Alcance
1. **Imágenes:** portadas, miniaturas, posts y carruseles. El prompt se arma con el perfil de marca (tono, colores, estilo) del publicador.
2. **Videos:** clips cortos verticales (Reels/Shorts/TikTok) y tutoriales: guion con LLM, voz, subtítulos, miniatura. Reutilizar lo que ya existe; extender solo lo necesario.
3. **Proveedores como interfaz** (`ImageProvider`, `VideoProvider`), con API key propia por proyecto vía `.env` y configuración; un proveedor simulado para pruebas sin costo.
4. **Costos:** acciones con costo = permisos facturables, fuera de los paquetes (seguir el patrón existente). Tope mensual configurable por proyecto y registro de uso/costo.
5. **Flujo único en el panel:** generar activo → SEO → programar → publicar (con el proveedor simulado de la Fase 1). Los activos generados quedan guardados y reutilizables como medios de la cola.
6. Documentar en `docs/FEATURES.md` y en la guía de copia del módulo a otros proyectos.

## Reglas
- Código en inglés; texto visible en español. Asistente = **Canix**.
- Sin `confirm()/prompt()/alert()`. Diseño con impeccable + Emil; móvil primero.
- Node 20: `PATH="/c/Users/Asus/node20:$PATH"` en Bash.
- Pruebas con BD temporal, nunca `data/app.db`.
- Heredocs largos fallan: scripts al scratchpad.
- Nunca imprimir `.env` ni secretos. No gastar créditos reales de proveedores: usar el simulado en las pruebas.

## NO tocar
`data/`, `auth_info/`, `.env`, servidor de producción. **No desplegar**, sin ssh ni sudo. Otros proyectos.
Sin conectores reales de YouTube/Meta/TikTok (fases siguientes).

## Terminado cuando
- `npm run typecheck` y `npm run build` pasan.
- Prueba con BD temporal: generar imagen y video con el proveedor simulado, pasarlos por SEO, programarlos y verlos publicados.
- Commit en español (skill `commit`).

## Al final
Escribe `.claude/noche-publisher-fase2-resultado.md`: **Hecho / Falta / Errores / Archivos clave**.
