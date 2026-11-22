#!/usr/bin/env bash
# Lets the Canix backend (user "canix") use the video taller in /opt/videos (admin panel > Videos y publicidad > Taller):
# write the rendered mp4 (out), the props (tmp) and the caches, and read the taller. Run ONCE with sudo:
#   sudo /opt/canix/deploy/ubuntu-11-setup-video-studio.sh
# Idempotent. Adds VIDEO_TALLER_DIR to the .env if missing.
set -euo pipefail

VIDEOS=/opt/videos
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -d "$VIDEOS/taller" ] || { echo "No existe $VIDEOS/taller: instala primero el taller de video."; exit 1; }

command -v setfacl >/dev/null || apt-get install -y -qq acl
mkdir -p "$VIDEOS/out" "$VIDEOS/tmp" "$VIDEOS/.cache"
# Traverse /opt/videos, write only where renders happen.
setfacl -m u:canix:rx "$VIDEOS"
setfacl -R -m u:canix:rwx "$VIDEOS/out" "$VIDEOS/tmp" "$VIDEOS/.cache"
setfacl -R -d -m u:canix:rwx "$VIDEOS/out" "$VIDEOS/tmp" "$VIDEOS/.cache"
setfacl -R -m u:canix:rX "$VIDEOS/taller" "$VIDEOS/proyectos" "$VIDEOS/tools" 2>/dev/null || true
[ -d "$VIDEOS/taller/node_modules/.cache" ] && setfacl -R -m u:canix:rwx "$VIDEOS/taller/node_modules/.cache"

if ! grep -q '^VIDEO_TALLER_DIR=' "$APP_DIR/.env" 2>/dev/null; then
  echo "VIDEO_TALLER_DIR=$VIDEOS/taller" >> "$APP_DIR/.env"
  echo "VIDEO_TALLER_DIR agregado al .env"
fi
# (restart is done by deploy.sh)
echo "Taller de video: listo para el usuario canix."
