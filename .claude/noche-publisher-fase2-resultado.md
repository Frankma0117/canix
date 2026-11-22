# Resultado: Publicador, Fase 2

**Hecho**
- Interfaces `ImageProvider`/`VideoProvider` con proveedor simulado (gratis) y fal.ai; clave por proyecto (`PUBLISHER_FAL_KEY` → `FAL_KEY`).
- Piezas generadas = material `g<id>` (tabla `publisher_assets`), reutilizable en la cola; generación en segundo plano.
- Topes: piezas/mes (compartido) y gasto USD/mes; costo por pieza = registro de uso; fallidas no cuentan.
- Flujo en el panel: «Crear con IA» → material → SEO → programar → publicar.
- Prueba `backend/scripts/publisher-generation-test.ts` (BD temporal): imagen y video simulados → SEO → programar → publicar OK.
- typecheck y build pasan. Docs en `docs/PUBLISHER.md`. Commit hecho (no desplegado).

**Falta**
- Probar el video de fal.ai con créditos reales (modelo/parámetros según el modelo).
- Desplegar (`deploy-canix`) cuando el usuario lo pida.

**Errores**: ninguno abierto.

**Archivos clave**: `backend/src/services/publisher/generation/*`, `publisher-media.ts`, `publisher.routes.ts`, `AssetGenerator.tsx`, `docs/PUBLISHER.md`.
