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
# `python3 -m venv --help` is NOT a real test - it just prints usage and exits 0 even when the
# distro's venv package (which provides ensurepip) isn't installed, so it never caught a missing
# python3-venv and let a broken, pip-less .venv get created further down. Testing that the
# ensurepip module actually imports is what venv creation itself depends on.
python3 -c "import ensurepip" >/dev/null 2>&1 || missing_pkgs="$missing_pkgs python3-venv"
command -v pip3 >/dev/null 2>&1 || missing_pkgs="$missing_pkgs python3-pip"
if [ -n "$missing_pkgs" ]; then
  echo "== Instalando dependencias que faltan:$missing_pkgs =="
  sudo apt-get update
  sudo apt-get install -y $missing_pkgs
fi

cd "$VISION_DIR"

# No basta con revisar que la carpeta .venv exista - un intento anterior interrumpido (Ctrl+C, sin
# espacio en disco, python3-venv faltante en ese momento) puede dejarla creada pero sin pip
# adentro, y el resto del script fallaria mas abajo con un error confuso ("No such file or
# directory") en vez de decir claramente que el venv esta roto. Se detecta por la presencia real
# de .venv/bin/pip, no solo por la carpeta.
if [ -x .venv/bin/pip ]; then
  echo "== Ya existe .venv (con pip), omito creacion =="
else
  if [ -d .venv ]; then
    echo "== .venv existe pero esta incompleto (sin pip, de un intento anterior) - lo borro y recreo =="
    rm -rf .venv
  fi
  echo "== Creando entorno virtual =="
  python3 -m venv .venv
  if [ ! -x .venv/bin/pip ]; then
    echo "== python3 -m venv no genero pip - reintentando con ensurepip =="
    .venv/bin/python -m ensurepip --upgrade || {
      echo "No se pudo instalar pip dentro del venv. Asegurate de tener el paquete de venv que"
      echo "corresponde a tu version de Python instalado (ej. 'sudo apt-get install -y python3-venv"
      echo "python3-pip') y vuelve a correr este script."
      exit 1
    }
  fi
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
