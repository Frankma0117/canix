#!/usr/bin/env bash
# Sets Canix up as a systemd service (starts on boot, restarts on failure). Run with sudo once the
# repo is at /opt/canix with a filled-in .env (the first ./deploy.sh does that).
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

echo "== Fixing ownership of $APP_DIR =="
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

echo "== Installing the systemd unit =="
cp "$APP_DIR/deploy/canix.service" /etc/systemd/system/canix.service
systemctl daemon-reload
systemctl enable canix

echo ""
echo "== Done. Useful commands: =="
echo "  sudo systemctl start canix     # start"
echo "  sudo systemctl stop canix      # stop"
echo "  sudo systemctl restart canix   # restart"
echo "  sudo journalctl -u canix -f    # live logs (the QR code shows up here the first time)"
