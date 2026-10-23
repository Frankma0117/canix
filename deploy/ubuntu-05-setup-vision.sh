#!/usr/bin/env bash
# Prepares Fashion Mode's vision microservice (garment photo classification with CLIP, 100% local,
# no paid API): creates its Python venv, installs dependencies and preloads the model to surface
# download/RAM problems now, not in the middle of a user's first real message. Needs /opt/canix.
# Safe to re-run: an existing, healthy venv is reused.
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
  echo "== Installing missing dependencies:$missing_pkgs =="
  sudo apt-get update
  sudo apt-get install -y $missing_pkgs
fi

cd "$VISION_DIR"

# Checking that the .venv folder exists is not enough - an earlier interrupted attempt (Ctrl+C, no
# disk space, python3-venv missing at the time) can leave it without pip inside, and the rest of
# the script would fail further down with a confusing "No such file or directory". It is detected
# by the actual .venv/bin/pip. pyvenv.cfg is required too: without it Python does not treat the
# folder as a venv and .venv/bin/pip acts as the system pip - which on Ubuntu 24.04 fails with
# "externally-managed-environment" (happened on the server, 2026-10).
if [ -x .venv/bin/pip ] && [ -f .venv/pyvenv.cfg ]; then
  echo "== .venv already exists (with pip), skipping creation =="
else
  if [ -d .venv ]; then
    echo "== .venv exists but is incomplete or broken (no pip or no pyvenv.cfg) - recreating it =="
    rm -rf .venv
  fi
  echo "== Creating the virtual environment =="
  python3 -m venv .venv
  if [ ! -x .venv/bin/pip ]; then
    echo "== python3 -m venv did not produce pip - retrying with ensurepip =="
    .venv/bin/python -m ensurepip --upgrade || {
      echo "Could not install pip inside the venv. Make sure the venv package for your Python"
      echo "version is installed (e.g. 'sudo apt-get install -y python3-venv python3-pip') and run"
      echo "this script again."
      exit 1
    }
  fi
fi

echo "== Installing Python dependencies (may take several minutes: downloads CPU torch) =="
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

echo ""
echo "== Preloading the model (the first time downloads ~300-400MB from Hugging Face) =="
.venv/bin/python -c "import model; model.load_model(); print('Model loaded OK.')"

echo ""
echo "== Free RAM right after loading the model (4GB server - check there is headroom left) =="
free -h

echo ""
echo "Done. Next step: deploy/ubuntu-06-setup-vision-service.sh (to run it as a systemd service)"
