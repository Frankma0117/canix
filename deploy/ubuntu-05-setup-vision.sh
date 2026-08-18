#!/usr/bin/env bash
# Deja listo el microservicio de vision de Fashion Mode (clasificacion de fotos de prendas via
# CLIP, 100% local, sin API paga) - crea su venv de Python, instala dependencias, y precarga el
# modelo para detectar problemas de descarga/RAM ahora, no en medio del primer mensaje real de un
# usuario. Correr despues de ubuntu-02-deploy.sh (necesita /opt/canix ya instalado). Seguro de
# re-correr: si el venv ya existe, no lo recrea.
set -euo pipefail

APP_DIR="/opt/canix"
VISION_DIR="$APP_DIR/vision-service"

missing_pkgs=""
command -v python3 >/dev/null 2>&1 || missing_pkgs="$missing_pkgs python3"
python3 -m venv --help >/dev/null 2>&1 || missing_pkgs="$missing_pkgs python3-venv"
command -v pip3 >/dev/null 2>&1 || missing_pkgs="$missing_pkgs python3-pip"
if [ -n "$missing_pkgs" ]; then
  echo "== Instalando dependencias que faltan:$missing_pkgs =="
  sudo apt-get update
  sudo apt-get install -y $missing_pkgs
fi

cd "$VISION_DIR"

if [ -d .venv ]; then
  echo "== Ya existe .venv, omito creacion =="
else
  echo "== Creando entorno virtual =="
  python3 -m venv .venv
fi

echo "== Instalando dependencias de Python (puede tardar varios minutos: descarga torch CPU) =="
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

echo ""
echo "== Precargando el modelo (primera vez descarga ~300-400MB desde Hugging Face) =="
.venv/bin/python -c "import model; model.load_model(); print('Modelo cargado OK.')"

echo ""
echo "== RAM libre justo despues de cargar el modelo (servidor de 4GB - revisa que quede margen) =="
free -h

echo ""
echo "Listo. Siguiente paso: deploy/ubuntu-06-setup-vision-service.sh (para dejarlo como servicio systemd)"
