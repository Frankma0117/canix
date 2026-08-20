#!/usr/bin/env bash
# Despliegue completo de Cania en un solo comando - pensado para correr siempre desde la raíz del
# repo ya clonado en el servidor (primera vez: `git clone ... /opt/canix && cd /opt/canix &&
# ./deploy.sh`; después, siempre el mismo `./deploy.sh` para actualizar).
#
# Idempotente y no destructivo a propósito:
#   - Nunca toca .env, data/ ni auth_info/ (todos gitignored - ver .gitignore).
#   - Si hay cambios locales sin commitear en el repo del servidor, se detiene ANTES de hacer
#     `git pull` en vez de arriesgarse a pisarlos - un deploy no debería poder perder trabajo.
#   - Cada paso (Node, systemd, audio, visión) reusa los scripts de deploy/*.sh ya existentes, que
#     ya son idempotentes por su cuenta (saltan lo que ya está instalado/descargado) - así que
#     volver a correr esto no reinstala ni redescarga nada de cero.
#   - Detecta solo (pm2 vs systemd) qué supervisor ya está usando el bot en ESTE servidor y lo
#     respeta - nunca cambia de uno a otro por su cuenta.
#
# Uso:
#   ./deploy.sh                 # TODO: código + deps + build + migraciones + audio + visión + reinicio
#   ./deploy.sh --no-audio      # todo menos transcripción/voz local (Vosk + Piper)
#   ./deploy.sh --no-vision     # todo menos el microservicio de visión de Fashion Mode (CLIP)
#   ./deploy.sh --no-audio --no-vision   # el deploy minimo de antes (o --minimal)
#
# Un solo comando cubre todo de ahora en adelante - no hace falta acordarse de correr los scripts
# de deploy/*.sh sueltos ni de pasar flags, este ya los encadena todos. --with-audio/--with-vision/
# --with-all se siguen aceptando (ya son el default, así que no hacen nada, pero no rompen scripts
# o alias viejos que ya los usen).
#
# IMPORTANTE: esto hace `git pull`, así que solo despliega lo que ya esté pusheado a GitHub - si
# acabas de terminar cambios en tu máquina, súbelos primero (`git push`) o este script no los verá.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

WITH_AUDIO=true
WITH_VISION=true
for arg in "$@"; do
  case "$arg" in
    --with-audio|--with-vision|--with-all|--all) : ;; # ya son el default, se aceptan sin efecto
    --no-audio) WITH_AUDIO=false ;;
    --no-vision) WITH_VISION=false ;;
    --minimal) WITH_AUDIO=false; WITH_VISION=false ;;
    -h|--help)
      sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Argumento desconocido: $arg (usa --no-audio, --no-vision, --minimal, --help)"
      exit 1
      ;;
  esac
done

step() { echo ""; echo "==> $1"; }

# --- 1. Node.js 20+ ----------------------------------------------------------
step "Verificando Node.js"
NODE_OK=false
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [ "$NODE_MAJOR" -ge 20 ]; then NODE_OK=true; fi
fi
if [ "$NODE_OK" = false ]; then
  echo "Node 20+ no encontrado (o versión vieja), instalando..."
  ./deploy/ubuntu-01-setup-node.sh
else
  echo "OK: $(node -v)"
fi

# --- 2. Código -----------------------------------------------------------------
step "Actualizando código"
if [ -d .git ]; then
  # Git refuses to touch a repo whose directory owner differs from the current user ("dubious
  # ownership") - happens here easily since some steps below run under sudo (chown'ing things to
  # root or a service user) while deploy.sh itself is normally run as a regular user. This repo
  # path is the deploy target itself, not untrusted input, so it's safe to always trust it - avoids
  # a confusing `git pull` failure with no code changed and no explanation.
  if ! git config --global --get-all safe.directory 2>/dev/null | grep -qxF "$SCRIPT_DIR"; then
    git config --global --add safe.directory "$SCRIPT_DIR"
  fi
  if [ -n "$(git status --porcelain)" ]; then
    echo "Hay cambios locales sin commitear en $SCRIPT_DIR - NO hago 'git pull' para no arriesgarme"
    echo "a perderlos. Revisa 'git status' ahí, guarda o descarta esos cambios, y vuelve a correr:"
    echo "  ./deploy.sh $*"
    exit 1
  fi
  git pull
else
  echo "Esto no es un repo git ($SCRIPT_DIR) - salto git pull (¿subiste los archivos por scp/rsync?)."
fi

# --- 3. Dependencias + build -----------------------------------------------------
step "Backend: dependencias"
npm ci

step "Panel admin: dependencias + build"
(cd admin-panel && npm ci && npm run build)

# --- 4. .env ---------------------------------------------------------------------
FIRST_ENV_SETUP=false
if [ ! -f .env ]; then
  step ".env no existe, copiando desde .env.example"
  cp .env.example .env
  FIRST_ENV_SETUP=true
fi

mkdir -p data

# --- 5. Migraciones de base de datos ----------------------------------------------
step "Aplicando migraciones de base de datos"
npm run db:init

# --- 6. Audio: transcripción + voz (opcional) --------------------------------------
if [ "$WITH_AUDIO" = true ]; then
  step "Transcripción/voz local (Vosk + Piper)"
  ./deploy/ubuntu-04-setup-audio.sh
fi

# --- 7. Microservicio de visión de Fashion Mode (opcional) ------------------------
if [ "$WITH_VISION" = true ]; then
  step "Microservicio de visión (Fashion Mode)"
  ./deploy/ubuntu-05-setup-vision.sh
  sudo ./deploy/ubuntu-06-setup-vision-service.sh
fi

# --- 8. (Re)iniciar el bot - respeta el supervisor que ya esté en uso -------------
detect_supervisor() {
  if command -v pm2 >/dev/null 2>&1 && pm2 jlist 2>/dev/null | grep -q '"name":"cania"'; then
    echo "pm2"
  elif systemctl list-unit-files 2>/dev/null | grep -q '^canix\.service'; then
    echo "systemd"
  else
    echo "none"
  fi
}

step "Reiniciando el bot"
SUPERVISOR="$(detect_supervisor)"
case "$SUPERVISOR" in
  pm2)
    echo "Detecté pm2 (proceso 'cania' ya existente) - reiniciando con él."
    pm2 restart cania
    pm2 save
    ;;
  systemd)
    echo "Detecté el servicio systemd 'canix' ya instalado - reiniciando con él."
    sudo systemctl restart canix
    ;;
  none)
    echo "No encontré el bot corriendo todavía (ni pm2 ni systemd) - primer arranque, uso pm2"
    echo "(más simple para empezar; ver README > Despliegue si preferís systemd)."
    if ! command -v pm2 >/dev/null 2>&1; then
      sudo npm install -g pm2
    fi
    pm2 start ecosystem.config.cjs
    pm2 save
    ;;
esac

# --- 9. Estado + logs recientes ----------------------------------------------------
step "Estado"
if [ "$SUPERVISOR" = "systemd" ]; then
  sudo systemctl --no-pager status canix || true
else
  pm2 status || true
fi

step "Logs recientes (busca aquí el QR si es la primera vez)"
if [ "$SUPERVISOR" = "systemd" ]; then
  sudo journalctl -u canix -n 25 --no-pager || true
else
  pm2 logs cania --lines 25 --nostream || true
fi

# --- 10. Recordatorios finales -------------------------------------------------------
step "Listo"
if [ "$FIRST_ENV_SETUP" = true ] || ! grep -q '^AI_API_KEY=.\+' .env 2>/dev/null; then
  echo "⚠️  Completa $SCRIPT_DIR/.env (sobre todo AI_API_KEY, AI_PROVIDER, AI_MODEL, AI_BASE_URL) y"
  echo "   vuelve a correr ./deploy.sh para que tome los valores nuevos."
fi
if [ "$SUPERVISOR" = "none" ]; then
  echo "Para que el bot arranque solo si el servidor se reinicia, corre UNA vez y sigue las"
  echo "instrucciones que imprime:  pm2 startup"
fi
if [ "$WITH_VISION" = true ] && ! grep -q '^FASHION_MODE_ENABLED=true' .env 2>/dev/null; then
  echo "El microservicio de visión ya está corriendo, pero Fashion Mode sigue apagado - una vez"
  echo "que tengas las credenciales de DigitalOcean Spaces (DO_SPACES_*) en .env, pon"
  echo "FASHION_MODE_ENABLED=true y corre ./deploy.sh de nuevo para reiniciar con el flag activo."
fi
if [ "$WITH_VISION" = false ]; then
  echo "Corriste con --no-vision: la clasificación automática de fotos de Fashion Mode quedó sin"
  echo "instalar. Corre './deploy.sh' (sin flags) cuando quieras agregarla."
fi
if ! grep -q '^TWILIO_ACCOUNT_SID=.\+' .env 2>/dev/null || ! grep -q '^TWILIO_AUTH_TOKEN=.\+' .env 2>/dev/null || ! grep -q '^TWILIO_PHONE_NUMBER=.\+' .env 2>/dev/null; then
  echo "⚠️  Recordatorios por llamada (Twilio) sin configurar - completa en .env TWILIO_ACCOUNT_SID,"
  echo "   TWILIO_AUTH_TOKEN y TWILIO_PHONE_NUMBER (console.twilio.com). Sin esto, schedule_call_reminder"
  echo "   y /api/call-reminders devuelven error en vez de llamar a nadie - el resto del bot sigue igual."
fi
if ! grep -q '^PANEL_URL=https\?://.\+' .env 2>/dev/null; then
  echo "⚠️  PANEL_URL no apunta a una URL pública - los recordatorios por llamada igual funcionan,"
  echo "   pero Twilio no podrá avisar el estado real de cada llamada (se quedan en \"processing\")."
  echo "   Ponla en .env (https://tu-dominio) para que /webhooks/twilio/call-status sea alcanzable."
fi
