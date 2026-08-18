#!/usr/bin/env bash
# Configura el microservicio de vision de Fashion Mode como servicio systemd (arranca solo, se
# reinicia si falla, sobrevive a reinicios del servidor). Correr con sudo despues de
# ubuntu-05-setup-vision.sh (necesita el venv ya instalado). Reusa el mismo usuario de servicio
# 'canix' que ubuntu-03-setup-service.sh crea para el bot principal - si todavia no corriste ese
# script, este lo crea igual.
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

echo "== Ajustando permisos de $APP_DIR/vision-service =="
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR/vision-service"

echo "== Instalando unidad systemd =="
cp "$APP_DIR/deploy/canix-vision.service" /etc/systemd/system/canix-vision.service
systemctl daemon-reload
systemctl enable canix-vision

echo ""
echo "== Arrancando el servicio (la primera vez puede tardar unos segundos en cargar el modelo) =="
systemctl restart canix-vision
sleep 2
systemctl --no-pager status canix-vision || true

echo ""
echo "== Listo. Comandos utiles: =="
echo "  sudo systemctl restart canix-vision   # reiniciar"
echo "  sudo systemctl stop canix-vision      # detener"
echo "  sudo journalctl -u canix-vision -f    # ver logs en vivo"
echo ""
echo "Verifica que responde:  curl http://127.0.0.1:8008/health"
echo ""
echo "Cuando /health responda {\"ok\":true,\"model_ready\":true}, activa el modulo en \$APP_DIR/.env:"
echo "  FASHION_MODE_ENABLED=true"
echo "  sudo systemctl restart canix"
