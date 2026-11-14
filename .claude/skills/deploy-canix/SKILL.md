---
name: deploy-canix
description: Despliega Canix a producción (push, ssh, deploy.sh, verificación). Úsala cuando pidan desplegar o actualizar canix en el servidor.
---

1. Local: `npm run typecheck` en la raíz (Node 20: `PATH="/c/Users/Asus/node20:$PATH"`). Si falla, no sigas.
2. `git status`: el deploy usa lo que está en GitHub. Haz commit solo de lo pedido y `git push origin main`.
3. El servidor es `ssh manuel@169.58.79.154`, carpeta `/opt/canix`. `sudo` pide contraseña: NO puedes
   ejecutar `sudo ./deploy.sh`; dile al usuario que corra `cd /opt/canix && sudo ./deploy.sh`.
4. Tras su confirmación verifica sin sudo: `ssh manuel@169.58.79.154 "systemctl is-active canix; journalctl -u canix -n 30 --no-pager"`.
5. Nunca toques n8n, maniksero, cania-web, panel, aula-interactiva ni brindix en ese servidor.
