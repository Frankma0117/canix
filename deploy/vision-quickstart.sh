#!/usr/bin/env bash
# Atajo para dejar el microservicio de vision de Fashion Mode funcionando de punta a punta en un
# solo comando: arregla el "dubious ownership" de git, actualiza el codigo, instala el venv de
# Python + dependencias + modelo CLIP, y lo deja corriendo como servicio systemd.
#
# Es lo mismo que hace `./deploy.sh --with-vision`, pero SIN pasar por el resto del deploy (Node,
# npm ci del backend/panel, migraciones, reinicio del bot) - util si el bot ya esta desplegado y
# corriendo, y solo falta/fallo la parte de vision. Si preferis dejar todo actualizado de una,
# usa `./deploy.sh --with-vision` en su lugar.
#
# Uso (desde donde sea, no hace falta estar parado en /opt/canix):
#   sudo ./deploy/vision-quickstart.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
cd "$APP_DIR"

step() { echo ""; echo "==> $1"; }

# --- 1. git pull, sin pelearse con "dubious ownership" -----------------------------
step "Actualizando codigo"
if [ -d .git ]; then
  # Se agrega para el usuario real (no root) aunque el script corra con sudo, porque el problema
  # de ownership lo sufre quien despues corra `git pull` a mano como usuario normal - ver
  # deploy.sh, que tiene el mismo arreglo para su propio git pull.
  REAL_USER="${SUDO_USER:-$USER}"
  if [ "$REAL_USER" != root ]; then
    sudo -u "$REAL_USER" git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
  fi
  git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

  if [ -n "$(git status --porcelain)" ]; then
    echo "Hay cambios locales sin commitear en $APP_DIR - no hago git pull para no arriesgarme a"
    echo "perderlos. Revisa 'git status' ahi, guarda o descarta esos cambios, y vuelve a correr esto."
    exit 1
  fi
  git pull
else
  echo "Esto no es un repo git ($APP_DIR) - salto git pull."
fi

# --- 2. Venv + dependencias + modelo CLIP -------------------------------------------
step "Instalando el microservicio de vision"
./deploy/ubuntu-05-setup-vision.sh

# --- 3. Servicio systemd -------------------------------------------------------------
step "Dejandolo como servicio systemd"
if [ "$(id -u)" -ne 0 ]; then
  sudo ./deploy/ubuntu-06-setup-vision-service.sh
else
  ./deploy/ubuntu-06-setup-vision-service.sh
fi

step "Listo"
echo "Verifica que responde:  curl http://127.0.0.1:8008/health"
echo "Cuando /health devuelva {\"ok\":true,\"model_ready\":true}, activa el modulo en .env:"
echo "  FASHION_MODE_ENABLED=true"
echo "  sudo systemctl restart canix   # o: pm2 restart cania"
