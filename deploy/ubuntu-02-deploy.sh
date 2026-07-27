#!/usr/bin/env bash
# Clona (o actualiza) canix en /opt/canix, instala dependencias y compila
# el panel admin. Correr como el usuario que tenga permiso de escribir en
# /opt (o ajustar APP_DIR). Requiere Node 20+ ya instalado (ver
# ubuntu-01-setup-node.sh).
set -euo pipefail

REPO_URL="https://github.com/Frankma0117/canix.git"
APP_DIR="/opt/canix"

if [ -d "$APP_DIR/.git" ]; then
  echo "== Repo ya existe, actualizando =="
  cd "$APP_DIR"
  git pull
else
  echo "== Clonando repo en $APP_DIR =="
  sudo mkdir -p "$APP_DIR"
  sudo chown "$(id -u):$(id -g)" "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

echo "== Instalando dependencias del backend =="
npm install

echo "== Instalando y compilando el panel admin =="
cd admin-panel
npm install
npm run build
cd ..

if [ ! -f .env ]; then
  echo "== No hay .env, copiando desde .env.example =="
  cp .env.example .env
  echo ""
  echo "!!! IMPORTANTE: edita $APP_DIR/.env antes de arrancar el servicio"
  echo "    (sobre todo AI_API_KEY, AI_PROVIDER, AI_MODEL, AI_BASE_URL)."
  echo "    Tip: en vez de editarlo a mano, puedes copiar tu .env local con:"
  echo "    scp .env usuario@servidor:$APP_DIR/.env"
else
  echo "== .env ya existe, no se toca =="
fi

mkdir -p data

echo ""
echo "== Deploy listo en $APP_DIR =="
echo "Siguiente paso: deploy/ubuntu-03-setup-service.sh (para dejarlo como servicio systemd)"
