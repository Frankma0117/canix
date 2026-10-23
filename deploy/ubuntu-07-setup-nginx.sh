#!/usr/bin/env bash
# Puts Canix behind nginx with real HTTPS (Let's Encrypt) for a domain that already points to this
# server - needed so Twilio can report each call's status (see
# backend/src/api/routes/twilio-webhook.routes.ts) and, in general, so the portal is never served
# over plain HTTP.
#
# PREREQUISITE (outside this script): a DNS A record from the domain/subdomain to this server's
# public IP, already propagated - certbot fails while the domain does not resolve here yet.
#
# Usage (as root or with sudo):
#   sudo ./deploy/ubuntu-07-setup-nginx.sh your-domain.com
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "This script needs sudo. Run: sudo $0 your-domain.com"
  exit 1
fi

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "Missing the domain. Usage: sudo $0 your-domain.com"
  exit 1
fi

# Same port as PORT in .env (default 3000, see backend/src/config/env.ts) - the app keeps listening
# on localhost only, nginx is the only public face.
APP_PORT="${APP_PORT:-3000}"

echo "== Installing nginx + certbot =="
apt-get update -qq
apt-get install -y nginx certbot python3-certbot-nginx

echo "== Configuring the server block for $DOMAIN -> 127.0.0.1:$APP_PORT =="
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
# nginx's "default" server block sometimes clashes with ours on port 80 - it is removed from
# sites-enabled (not deleted: it stays in sites-available in case it is needed later).
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx

echo "== Requesting the TLS certificate with certbot (also sets up the http->https redirect) =="
certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos -m "admin@$DOMAIN" || {
  echo ""
  echo "certbot failed - most often the DNS of $DOMAIN does not point to this server yet."
  echo "Check with:  dig +short $DOMAIN   (must return this server's IP)"
  exit 1
}

echo ""
echo "== Done =="
echo "Now put this in your .env and run ./deploy.sh again (or restart the bot):"
echo "  PANEL_URL=https://$DOMAIN"
echo ""
echo "Check that the portal loads at https://$DOMAIN and that /webhooks/twilio/call-status answers"
echo "(a plain GET gives 404, that's fine - only Twilio sends it POSTs)."
