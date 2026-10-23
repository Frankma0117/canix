#!/usr/bin/env bash
# Sets Fashion Mode's vision microservice up as a systemd service (starts on boot, restarts on
# failure). Run with sudo after ubuntu-05-setup-vision.sh (needs its venv). Reuses the 'canix'
# service user that ubuntu-03-setup-service.sh creates for the bot - creates it if missing.
set -euo pipefail

APP_DIR="/opt/canix"
SERVICE_USER="canix"

if [ "$(id -u)" -ne 0 ]; then
  echo "This script needs sudo. Run: sudo $0"
  exit 1
fi

echo "== Creating service user '$SERVICE_USER' (no login) =="
if ! id "$SERVICE_USER" &>/dev/null; then
  useradd -r -s /usr/sbin/nologin "$SERVICE_USER"
fi

echo "== Fixing ownership of $APP_DIR/vision-service =="
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR/vision-service"

echo "== Installing the systemd unit =="
cp "$APP_DIR/deploy/canix-vision.service" /etc/systemd/system/canix-vision.service
systemctl daemon-reload
systemctl enable canix-vision

echo ""
echo "== Starting the service (the first time it can take a few seconds to load the model) =="
systemctl restart canix-vision
sleep 2
systemctl --no-pager status canix-vision || true

echo ""
echo "== Done. Useful commands: =="
echo "  sudo systemctl restart canix-vision   # restart"
echo "  sudo systemctl stop canix-vision      # stop"
echo "  sudo journalctl -u canix-vision -f    # live logs"
echo ""
echo "Check that it answers:  curl http://127.0.0.1:8008/health"
echo ""
echo "Once /health answers {\"ok\":true,\"model_ready\":true}, enable the module in \$APP_DIR/.env:"
echo "  FASHION_MODE_ENABLED=true"
echo "  sudo systemctl restart canix"
