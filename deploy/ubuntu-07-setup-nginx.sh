#!/usr/bin/env bash
# Pone Canix detras de nginx con HTTPS real (Let's Encrypt) para un dominio que ya apunte a este
# servidor - necesario para que Twilio pueda avisar el estado de cada llamada (ver
# src/server/twilio-webhook.ts) y, en general, para no exponer el panel por HTTP plano.
#
# Requisito PREVIO (fuera de este script): un registro DNS tipo A del dominio/subdominio hacia la
# IP publica de este servidor, ya propagado - certbot falla si el dominio todavia no resuelve aqui.
#
# Uso (como root o con sudo):
#   sudo ./deploy/ubuntu-07-setup-nginx.sh tu-dominio.com
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Este script necesita sudo. Corre: sudo $0 tu-dominio.com"
  exit 1
fi

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "Falta el dominio. Uso: sudo $0 tu-dominio.com"
  exit 1
fi

# Mismo puerto que PORT en .env (default 3000, ver src/config/env.ts) - la app sigue escuchando
# solo en localhost, nginx es la unica cara publica.
APP_PORT="${APP_PORT:-3000}"

echo "== Instalando nginx + certbot =="
apt-get update -qq
apt-get install -y nginx certbot python3-certbot-nginx

echo "== Configurando el server block para $DOMAIN -> 127.0.0.1:$APP_PORT =="
CONF_PATH="/etc/nginx/sites-available/cania.conf"
cat > "$CONF_PATH" <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
ln -sf "$CONF_PATH" /etc/nginx/sites-enabled/cania.conf
# El server block "default" de nginx a veces choca con el nuestro en el puerto 80 - lo saca de
# sites-enabled si sigue ahi, no lo borra (queda en sites-available por si se necesita despues).
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx

echo "== Pidiendo el certificado TLS con certbot (tambien deja el redirect http->https) =="
certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos -m "admin@$DOMAIN" || {
  echo ""
  echo "certbot fallo - lo mas comun es que el DNS de $DOMAIN todavia no apunte a este servidor."
  echo "Verifica con:  dig +short $DOMAIN   (debe devolver la IP de este servidor)"
  exit 1
}

echo ""
echo "== Listo =="
echo "Ahora pon esto en tu .env y vuelve a correr ./deploy.sh (o reinicia el bot):"
echo "  PANEL_URL=https://$DOMAIN"
echo ""
echo "Verifica que el panel cargue en https://$DOMAIN y que /webhooks/twilio/call-status responda"
echo "(un GET normal dara 404, eso esta bien - solo Twilio le manda POST)."
