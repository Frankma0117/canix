#!/usr/bin/env bash
# Installs what the admin's "Videos y publicidad" needs to draw and record (backend/src/services/promo/):
# the libraries of a headless Chromium (Playwright), the color emoji font for the drawn WhatsApp chats,
# and the browser itself inside the repo (bin/ms-playwright, never versioned). ffmpeg already comes
# with the npm package ffmpeg-static. Run by deploy.sh; safe to re-run: what is installed is skipped.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PLAYWRIGHT_BROWSERS_PATH="$APP_DIR/bin/ms-playwright"
cd "$APP_DIR/backend"

if ! fc-list 2>/dev/null | grep -qi "Noto Color Emoji"; then
  echo "== Emoji font (fonts-noto-color-emoji) =="
  sudo apt-get update -qq
  sudo apt-get install -y -qq fonts-noto-color-emoji fontconfig
fi

# The system libraries Chromium needs (libnss3, libgbm, libatk...): apt only installs the missing ones.
echo "== Libraries of the recording browser =="
sudo npx --yes playwright install-deps chromium

if ls "$PLAYWRIGHT_BROWSERS_PATH"/chromium_headless_shell-*/ >/dev/null 2>&1 || ls "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/ >/dev/null 2>&1; then
  echo "== Recording browser already installed =="
else
  echo "== Recording browser (Chromium, ~180 MB in bin/ms-playwright) =="
  npx --yes playwright install chromium
fi
echo "Videos y publicidad: ready."
