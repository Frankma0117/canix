#!/usr/bin/env bash
# Publica la página de venta de Canix en su propio subdominio (ej. canix.cania.app) con HTTPS.
# La misma app (puerto 3000) sirve la página en "/" cuando la visitan por ese dominio (ver
# src/growth/routes.ts); el portal sigue igual en su dominio de siempre.
#
# Requisito PREVIO: un registro DNS tipo A del subdominio hacia la IP de este servidor, ya
# propagado (verifícalo con: dig +short canix.cania.app). Sin eso certbot falla.
#
# Uso:
#   sudo ./deploy/ubuntu-08-setup-landing.sh canix.cania.app
#
# Seguro de re-correr. NO toca los server blocks que ya existan (portal, otros sitios).
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Este script necesita sudo. Corre: sudo $0 canix.tu-dominio.com"
  exit 1
fi

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "Falta el subdominio. Uso: sudo $0 canix.tu-dominio.com"
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PORT="${APP_PORT:-3000}"
CONF_NAME="canix-landing"
CONF_PATH="/etc/nginx/sites-available/$CONF_NAME"

echo "== Revisando DNS de $DOMAIN =="
RESOLVED="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
MYIP="$(curl -s --max-time 5 https://api.ipify.org || true)"
echo "  $DOMAIN -> ${RESOLVED:-(no resuelve)}   este servidor: ${MYIP:-desconocida}"
if [ -z "$RESOLVED" ]; then
  echo "El subdominio todavía no resuelve. Crea el registro A ($DOMAIN -> ${MYIP:-IP del servidor}) y espera unos minutos."
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1 || ! command -v certbot >/dev/null 2>&1; then
  echo "== Instalando nginx + certbot =="
  apt-get update -qq
  apt-get install -y nginx certbot python3-certbot-nginx
fi

if [ ! -f "$CONF_PATH" ]; then
  echo "== Creando el server block $CONF_NAME ($DOMAIN -> 127.0.0.1:$APP_PORT) =="
  cat > "$CONF_PATH" <<EOF
server {
    listen 80;
    listen [::]:80;
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
  ln -sf "$CONF_PATH" "/etc/nginx/sites-enabled/$CONF_NAME"
  nginx -t
  systemctl reload nginx
else
  echo "== $CONF_PATH ya existe, lo dejo como está =="
fi

echo "== Certificado HTTPS (Let's Encrypt) =="
certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos --register-unsafely-without-email || {
  echo "certbot falló - revisa que $DOMAIN apunte a este servidor (dig +short $DOMAIN)."
  exit 1
}

echo "== Guardando LANDING_URL en $APP_DIR/.env =="
ENV_FILE="$APP_DIR/.env"
if grep -q '^LANDING_URL=' "$ENV_FILE" 2>/dev/null; then
  sed -i "s#^LANDING_URL=.*#LANDING_URL=https://$DOMAIN#" "$ENV_FILE"
else
  printf '\n# Página pública de venta (ver deploy/ubuntu-08-setup-landing.sh)\nLANDING_URL=https://%s\n' "$DOMAIN" >> "$ENV_FILE"
fi

if systemctl list-unit-files canix.service >/dev/null 2>&1 && systemctl cat canix.service >/dev/null 2>&1; then
  systemctl restart canix
  echo "Bot reiniciado para tomar LANDING_URL."
fi

echo ""
echo "== Listo =="
echo "Página de venta:  https://$DOMAIN"
echo "Sitemap:          https://$DOMAIN/sitemap.xml   (envíalo en Google Search Console)"
