#!/usr/bin/env bash
# Publishes Canix's sales page on its own subdomain (e.g. canix.cania.app) with HTTPS. The same app
# (port 3000) serves the page at "/" when visited through that domain (see
# backend/src/api/routes/growth.routes.ts); the portal keeps working on its usual domain.
#
# PREREQUISITE: a DNS A record from the subdomain to this server's IP, already propagated (check
# with: dig +short canix.cania.app). certbot fails without it.
#
# Usage:
#   sudo ./deploy/ubuntu-08-setup-landing.sh canix.cania.app
#
# Safe to re-run. Does NOT touch existing server blocks (portal, other sites).
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "This script needs sudo. Run: sudo $0 canix.your-domain.com"
  exit 1
fi

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "Missing the subdomain. Usage: sudo $0 canix.your-domain.com"
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PORT="${APP_PORT:-3000}"
CONF_NAME="canix-landing"
CONF_PATH="/etc/nginx/sites-available/$CONF_NAME"

echo "== Checking DNS for $DOMAIN =="
RESOLVED="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
MYIP="$(curl -s --max-time 5 https://api.ipify.org || true)"
echo "  $DOMAIN -> ${RESOLVED:-(does not resolve)}   this server: ${MYIP:-unknown}"
if [ -z "$RESOLVED" ]; then
  echo "The subdomain does not resolve yet. Create the A record ($DOMAIN -> ${MYIP:-server IP}) and wait a few minutes."
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1 || ! command -v certbot >/dev/null 2>&1; then
  echo "== Installing nginx + certbot =="
  apt-get update -qq
  apt-get install -y nginx certbot python3-certbot-nginx
fi

if [ ! -f "$CONF_PATH" ]; then
  echo "== Creating server block $CONF_NAME ($DOMAIN -> 127.0.0.1:$APP_PORT) =="
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
  echo "== $CONF_PATH already exists, leaving it as is =="
fi

echo "== HTTPS certificate (Let's Encrypt) =="
certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos --register-unsafely-without-email || {
  echo "certbot failed - check that $DOMAIN points to this server (dig +short $DOMAIN)."
  exit 1
}

echo "== Saving LANDING_URL in $APP_DIR/.env =="
ENV_FILE="$APP_DIR/.env"
if grep -q '^LANDING_URL=' "$ENV_FILE" 2>/dev/null; then
  sed -i "s#^LANDING_URL=.*#LANDING_URL=https://$DOMAIN#" "$ENV_FILE"
else
  printf '\n# Public sales page (see deploy/ubuntu-08-setup-landing.sh)\nLANDING_URL=https://%s\n' "$DOMAIN" >> "$ENV_FILE"
fi

if systemctl list-unit-files canix.service >/dev/null 2>&1 && systemctl cat canix.service >/dev/null 2>&1; then
  systemctl restart canix
  echo "Bot restarted to pick up LANDING_URL."
fi

echo ""
echo "== Done =="
echo "Sales page:  https://$DOMAIN"
echo "Sitemap:     https://$DOMAIN/sitemap.xml   (submit it in Google Search Console)"
