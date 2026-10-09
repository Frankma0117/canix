#!/usr/bin/env bash
# Despliegue completo de Canix en un solo comando - pensado para correr siempre desde la raíz del
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
# IMPORTANTE: esto trae lo que esté en GitHub (origin/main), así que solo despliega lo que ya esté
# pusheado - si acabas de terminar cambios en tu máquina, súbelos primero (`git push`).
#
# Se corre como `sudo ./deploy.sh` (o sin sudo: si el repo no es escribible por tu usuario, se
# relanza solo con sudo) - el repo es del usuario de servicio 'canix' y el reinicio necesita root.
set -euo pipefail

# Todo el script va dentro de main(): bash lo lee COMPLETO antes de ejecutar nada, así que aunque
# git reemplace este archivo a mitad del deploy, la ejecución en curso no se corrompe.
main() {

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SELF_HASH="$(sha256sum "$SCRIPT_DIR/deploy.sh" | cut -d' ' -f1)"

if [ "$(id -u)" -ne 0 ] && [ ! -w "$SCRIPT_DIR/.git" ]; then
  echo "El repo ($SCRIPT_DIR) no es escribible por $(id -un) - me relanzo con sudo."
  exec sudo "$0" "$@"
fi

# Archivos que el bot escribe en tiempo de ejecución y que NUNCA deben versionarse (un commit
# hecho a mano en el servidor llegó a meter data/canix.lock y los __pycache__ de vision-service).
is_runtime_junk() { grep -qE '^(data/canix\.lock|.*__pycache__/.*|.*\.pyc)$'; }

WITH_AUDIO=true
WITH_VISION=true
VISION_FAILED=false
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
  if ! git config --global --get-all safe.directory 2>/dev/null | grep -xF "$SCRIPT_DIR" >/dev/null; then
    git config --global --add safe.directory "$SCRIPT_DIR"
  fi
  # Cambios "sucios" que son solo archivos de runtime (el lock del bot, caches de Python): se
  # descartan, no son trabajo de nadie. Cualquier otro cambio sin commitear sí detiene el deploy.
  JUNK_DIRTY="$(git status --porcelain | awk '{print $2}' | while read -r f; do echo "$f" | is_runtime_junk && echo "$f"; done || true)"
  if [ -n "$JUNK_DIRTY" ]; then
    echo "Descarto cambios de archivos de runtime: $(echo $JUNK_DIRTY)"
    echo "$JUNK_DIRTY" | xargs -r git checkout -- 2>/dev/null || true
  fi
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "Hay cambios locales sin commitear en $SCRIPT_DIR - NO actualizo el código para no arriesgarme"
    echo "a perderlos. Revisa 'git status' ahí, guarda o descarta esos cambios, y vuelve a correr:"
    echo "  ./deploy.sh $*"
    exit 1
  fi

  git fetch origin
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  if [ -n "$(git rev-list "origin/$BRANCH..HEAD")" ]; then
    # Commits que solo existen en el servidor. Si únicamente tocan basura de runtime (el caso real:
    # "Cambios remotos" con data/canix.lock y .pyc), el servidor se alinea con GitHub; si traen
    # cambios de verdad, se hace merge como antes para no perderlos.
    LOCAL_ONLY_FILES="$(git diff --name-only "origin/$BRANCH...HEAD")"
    if [ -z "$(echo "$LOCAL_ONLY_FILES" | grep -v '^$' | while read -r f; do echo "$f" | is_runtime_junk || echo "$f"; done)" ]; then
      echo "El servidor tenía commits propios solo con archivos de runtime - lo alineo con origin/$BRANCH."
      git reset -q --hard "origin/$BRANCH"
    else
      echo "El servidor tiene commits propios con cambios reales - hago merge con origin/$BRANCH:"
      echo "$LOCAL_ONLY_FILES" | sed 's/^/   /'
      git merge --no-edit "origin/$BRANCH"
    fi
  else
    git merge --ff-only "origin/$BRANCH"
  fi
  echo "Código en: $(git log --oneline -1)"
  # Si esta actualización trajo una versión nueva de este mismo script, se relanza: bash lee el
  # archivo mientras lo ejecuta, y seguir con la versión vieja (o una mezcla) fue lo que dejó
  # deploys a medias.
  if [ "$(sha256sum "$SCRIPT_DIR/deploy.sh" | cut -d' ' -f1)" != "$SELF_HASH" ] && [ -z "${CANIX_DEPLOY_REEXEC:-}" ]; then
    echo "deploy.sh cambió con esta actualización - me relanzo con la versión nueva."
    export CANIX_DEPLOY_REEXEC=1
    exec bash "$SCRIPT_DIR/deploy.sh" "$@"
  fi
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

# Sin tuberías hacia `grep -q`: con `set -o pipefail`, grep -q cierra la tubería en la primera
# coincidencia, el comando de la izquierda muere por SIGPIPE y la tubería entera "falla" - así es
# como systemd nunca se detectaba y el deploy terminaba reiniciando el pm2 de root (2026-10).
has_pm2_cania() {
  command -v pm2 >/dev/null 2>&1 || return 1
  local list
  list="$(pm2 jlist 2>/dev/null || true)"
  [[ "$list" == *'"name":"cania"'* ]]
}
has_systemd_canix() { systemctl cat canix.service >/dev/null 2>&1; }
detect_supervisor() {
  # systemd gana si existe: corre como el usuario 'canix' (no root) y es el que arranca solo con el
  # servidor. Tener ADEMÁS un 'cania' en pm2 es justo lo que dejó dos bots sobre la misma sesión de
  # WhatsApp en producción (2026-10) - ver el paso 7.9, que lo elimina de pm2.
  if has_systemd_canix; then
    echo "systemd"
  elif has_pm2_cania; then
    echo "pm2"
  else
    echo "none"
  fi
}
SUPERVISOR="$(detect_supervisor)"

# --- 6. Audio: transcripción + voz (opcional) --------------------------------------
if [ "$WITH_AUDIO" = true ]; then
  step "Transcripción/voz local (Vosk + Piper)"
  ./deploy/ubuntu-04-setup-audio.sh
fi

# --- 7. Microservicio de visión de Fashion Mode (opcional) ------------------------
if [ "$WITH_VISION" = true ]; then
  step "Microservicio de visión (Fashion Mode)"
  # Es un servicio aparte y opcional: si su instalación falla, se avisa al final pero el bot se
  # despliega y reinicia igual (antes un error de pip aquí dejaba el bot sin actualizar).
  if ./deploy/ubuntu-05-setup-vision.sh && sudo ./deploy/ubuntu-06-setup-vision-service.sh; then
    VISION_FAILED=false
  else
    VISION_FAILED=true
    echo "⚠️  Falló la instalación del microservicio de visión - sigo con el deploy del bot."
  fi
fi

# --- 7.5 Permisos para el usuario de servicio (solo systemd) ----------------------
# Bajo systemd, canix.service corre como el usuario dedicado "canix" (ver deploy/canix.service),
# pero TODO lo anterior en este script (git pull, npm ci, mkdir -p data, npm run db:init, los
# scripts de audio/visión) corrió como quien te conectaste por SSH (root, ubuntu, etc.), así que
# cualquier archivo nuevo que hayan creado (sobre todo data/canix.lock y data/*.db) queda con OTRO
# dueño. El servicio systemd entonces no puede ni escribir su propio lock file (EACCES) y queda en
# crash-loop reiniciándose cada pocos segundos - esto es exactamente lo que pasó el 2026-08-20.
# ubuntu-03-setup-service.sh hace este mismo chown, pero solo una vez en la instalación inicial; acá
# lo repetimos en cada deploy para que nunca se desalinee de nuevo.
if [ "$SUPERVISOR" = "systemd" ] && id canix &>/dev/null && [ "$(id -un)" != "canix" ]; then
  step "Ajustando permisos para el usuario de servicio 'canix'"
  sudo chown -R canix:canix "$SCRIPT_DIR"
fi

# --- 7.9 Una sola instancia -------------------------------------------------------
# Dos bots sobre la misma sesión de WhatsApp se pisan (mensajes duplicados, respuestas que no
# llegan). En 2026-10 había un `npm run start` manual de root corriendo desde hacía semanas junto al
# servicio systemd. Antes de reiniciar: se detiene el supervisor y se mata cualquier otro proceso
# del bot cuyo directorio de trabajo sea este repo, sea de quien sea.
step "Deteniendo instancias del bot (incluidas las manuales/duplicadas)"
case "$SUPERVISOR" in
  pm2) pm2 stop cania >/dev/null 2>&1 || true ;;
  systemd)
    sudo systemctl stop canix || true
    if has_pm2_cania; then
      echo "Había un 'cania' en pm2 además del servicio systemd - lo elimino de pm2 (queda solo systemd)."
      pm2 delete cania >/dev/null 2>&1 || true
      pm2 save >/dev/null 2>&1 || true
    fi
    ;;
esac
bot_pids() {
  for pid in $(pgrep -f 'src/index\.ts' || true); do
    [ "$pid" = "$$" ] && continue
    [ "$(sudo readlink "/proc/$pid/cwd" 2>/dev/null)" = "$SCRIPT_DIR" ] && echo "$pid"
  done
}
STRAY="$(bot_pids | tr '\n' ' ')"
if [ -n "${STRAY// /}" ]; then
  echo "Detengo procesos sueltos del bot: $STRAY"
  sudo kill $STRAY 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do [ -z "$(bot_pids)" ] && break; sleep 1; done
  STILL="$(bot_pids | tr '\n' ' ')"
  [ -n "${STILL// /}" ] && { echo "No respondieron a SIGTERM, fuerzo: $STILL"; sudo kill -9 $STILL 2>/dev/null || true; }
else
  echo "No había instancias sueltas."
fi
sudo rm -f "$SCRIPT_DIR/data/canix.lock"

# --- 8. (Re)iniciar el bot - respeta el supervisor que ya esté en uso -------------
step "Reiniciando el bot"
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
if [ "$VISION_FAILED" = true ]; then
  echo "⚠️  El microservicio de visión (Fashion Mode) NO se instaló bien - revisa el error arriba. Fashion"
  echo "   Mode sigue funcionando pidiendo clasificar las prendas a mano. Vuelve a correr ./deploy.sh"
  echo "   cuando lo corrijas."
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
env_val() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//'; }
if [ -z "$(env_val FISH_AUDIO_API_KEY)" ]; then
  echo "⚠️  FISH_AUDIO_API_KEY vacía - la voz natural (permiso 'Voz natural (IA)') queda desactivada y todas"
  echo "   las notas de voz usan Piper local. Agrega en .env FISH_AUDIO_API_KEY (y opcional FISH_AUDIO_VOICE_MALE/"
  echo "   FISH_AUDIO_VOICE_FEMALE, ver .env.example) y vuelve a correr ./deploy.sh."
fi
PANEL_URL_VAL="$(env_val PANEL_URL)"
if [[ "$PANEL_URL_VAL" =~ ^https:// ]]; then
  # El audio de voz natural de las llamadas y los avisos de estado de Twilio llegan por esta URL:
  # se comprueba que desde internet responda ESTE bot (404 propio de una ruta de audio inexistente),
  # no un 502 de nginx ni otro servicio.
  PROBE="${PANEL_URL_VAL%/}/media/call-audio/000000000000000000000000000000000000000000000000.mp3"
  CODE=""
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
    CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$PROBE" || true)"
    [ "$CODE" = "404" ] && break
    sleep 5
  done
  if [ "$CODE" = "404" ]; then
    echo "OK: PANEL_URL ($PANEL_URL_VAL) llega a este bot - Twilio puede descargar el audio de voz natural."
  else
    echo "⚠️  PANEL_URL ($PANEL_URL_VAL) no respondió como este bot (HTTP $CODE). Revisa nginx/DNS/SSL:"
    echo "   las llamadas usarán la voz de Twilio y su estado puede quedarse en \"processing\"."
  fi
elif [ -n "$PANEL_URL_VAL" ]; then
  echo "⚠️  PANEL_URL ($PANEL_URL_VAL) no es https - Twilio necesita https para la voz natural en llamadas."
fi
if ! grep -q '^PANEL_URL=https\?://.\+' .env 2>/dev/null; then
  echo "⚠️  PANEL_URL no apunta a una URL pública - los recordatorios por llamada igual funcionan,"
  echo "   pero Twilio no podrá avisar el estado real de cada llamada (se quedan en \"processing\")."
  echo "   Ponla en .env (https://tu-dominio) para que /webhooks/twilio/call-status sea alcanzable."
fi
}

main "$@"
exit $?
