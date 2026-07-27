#!/usr/bin/env bash
# Configura canix como servicio systemd (arranca solo, se reinicia si falla,
# sobrevive a reinicios del servidor). Correr con sudo despues de
# ubuntu-02-deploy.sh (necesita /opt/canix ya instalado con .env listo).
set -euo pipefail

APP_DIR="/opt/canix"
SERVICE_USER="canix"

if [ "$(id -u)" -ne 0 ]; then
  echo "Este script necesita sudo. Corre: sudo $0"
  exit 1
fi

echo "== Creando usuario de servicio '$SERVICE_USER' (sin login) =="
if ! id "$SERVICE_USER" &>/dev/null; then
  useradd -r -s /usr/sbin/nologin "$SERVICE_USER"
fi

echo "== Ajustando permisos de $APP_DIR =="
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

echo "== Creando carpeta de logs =="
mkdir -p /var/log/canix
chown "$SERVICE_USER:$SERVICE_USER" /var/log/canix

echo "== Instalando unidad systemd =="
cp "$APP_DIR/deploy/canix.service" /etc/systemd/system/canix.service
systemctl daemon-reload
systemctl enable canix

echo ""
echo "== Listo. Comandos utiles: =="
echo "  sudo systemctl start canix     # arrancar"
echo "  sudo systemctl stop canix      # detener"
echo "  sudo systemctl restart canix   # reiniciar"
echo "  sudo journalctl -u canix -f    # ver logs en vivo (aqui sale el QR la primera vez)"
