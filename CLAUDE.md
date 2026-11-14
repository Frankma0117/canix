# CLAUDE.md — Canix

Asistente personal de WhatsApp (recordatorios, tareas/rutinas, biblioteca de enlaces, agenda,
ejercicios, comidas, medicamentos, pedidos para negocios) con panel web. Responde SIEMPRE en español.
El asistente se llama **Canix** (nunca Cania); la infraestructura y el dominio son `cania.app`.

## Mapa
- `backend/` — Node 20 + TypeScript (ESM), Baileys, SQLite (better-sqlite3), agente con tools (LLM compatible OpenAI).
  `src/agent` (bucle y tools), `src/channels` (WhatsApp), `src/api` (Express), `src/services`, `src/jobs`,
  `src/database` (migraciones), `src/entities`, `src/config`, `src/shared`.
- `frontend/` — React + Vite (portal y admin), compila a `/public`. `frontend/landing` = sitio público.
- `vision-service/` (CLIP, moda), `deploy/` (scripts de servidor), `docs/` (ARCHITECTURE, API, DATABASE,
  DEPLOYMENT, FEATURES, OPERATIONS, SECURITY, SEO): léelos solo si la tarea los necesita.
- Datos locales: `data/` (SQLite), `auth_info/` (sesión WhatsApp), `.env`. Nunca imprimir `.env` ni secretos.

## Comandos (en la raíz)
- Node 20 está en `C:\Users\Asus\node20`; el `node` del sistema es 18. Con comandos sueltos:
  `PATH="/c/Users/Asus/node20:$PATH"` en Bash, o usa los `.cmd` del proyecto.
- `npm run typecheck` · `npm run dev` · `npm run dev:frontend` · `npm run build` · `npm run db:migrate`.
- Los scripts de prueba que usan la BD (ESM) van contra una BD temporal, no contra `data/app.db`.

## Producción
- `ssh manuel@169.58.79.154`, app en `/opt/canix`, systemd `canix` (usuario `canix`). Dominio `https://canix.cania.app`.
- Despliegue = push a GitHub y luego `ssh manuel@169.58.79.154 "sudo /opt/canix/deploy.sh"` (sudo sin contraseña solo para ese script, desde 2026-11-14).
  Ver la skill `deploy-canix`.
- En ese servidor viven otros proyectos (n8n, maniksero, cania-web, panel, aula-interactiva, brindix): no tocarlos.

## Negocios: ventas y servicios (NO son lo mismo)
- `stores.kind`: `sales` (productos, pedidos, domicilio, pagos) o `services` (citas, profesionales, agenda). Cada tipo tiene su propio asistente, menú y pantallas; nunca mezclar el flujo de pedidos con el de citas. Detalle en `docs/FEATURES.md`.

## Reglas del usuario
- Confirmaciones con reacciones 👍/👎; nunca encuestas.
- Stickers solo del pack del administrador; nunca generar stickers.
- Código e identificadores en inglés; texto visible en español. Mensajes por WhatsApp y web siempre.
- Diseño: seguir skills impeccable + taste (landing) + Emil (movimiento). Sin `confirm()/prompt()/alert()`.
- Heredocs largos fallan en Bash aquí: escribe un script al scratchpad y ejecútalo.
- Las acciones que el LLM pueda ejecutar con costo (voz, imágenes) son permisos facturables, fuera de los paquetes.
