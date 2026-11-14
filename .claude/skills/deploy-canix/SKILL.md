---
name: deploy-canix
description: Despliega Canix a producción (push, ssh, deploy.sh, verificación). Úsala cuando pidan desplegar o actualizar canix en el servidor.
---

1. Local: `npm run typecheck` en la raíz (Node 20: `PATH="/c/Users/Asus/node20:$PATH"`). Si falla, no sigas.
2. `git status`: el deploy usa lo que está en GitHub. Haz commit solo de lo pedido y `git push origin main`.
3. Despliega sin contraseña (sudoers NOPASSWD solo para ese script):
   `ssh manuel@169.58.79.154 "sudo /opt/canix/deploy.sh" 2>&1 | tail -40`
   Si pide contraseña, la regla `/etc/sudoers.d/canix-deploy` no existe: díselo al usuario.
4. Verifica: `ssh manuel@169.58.79.154 "systemctl is-active canix; journalctl -u canix -n 30 --no-pager"`
   y `curl -fsS -o /dev/null -w "%{http_code}" https://canix.cania.app`.
5. Nunca toques n8n, maniksero, cania-web, panel, aula-interactiva ni brindix en ese servidor.
