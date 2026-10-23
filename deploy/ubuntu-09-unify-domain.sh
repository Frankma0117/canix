#!/usr/bin/env bash
# Moves ALL of Canix onto a single domain (e.g. canix.cania.app: sales page at "/", portal and
# administration at "/app") and cleans up the old domain (e.g. virtual-assistant.cania.app):
#   - by default turns it into a 301 REDIRECT to the new domain (the root goes to /app, because
#     password messages already sent point there; any other path keeps its path),
#   - with --remove deletes it completely (nginx site + certificate).
# Updates PANEL_URL and LANDING_URL in .env and restarts the bot. Does NOT touch any other nginx
# site. Before changing anything it saves a copy under /root/nginx-backup-<date>/.
#
# Usage:
#   sudo ./deploy/ubuntu-09-unify-domain.sh virtual-assistant.cania.app canix.cania.app
#   sudo ./deploy/ubuntu-09-unify-domain.sh virtual-assistant.cania.app canix.cania.app --remove
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Needs sudo: sudo $0 old-domain new-domain [--remove]"
  exit 1
fi
OLD="${1:-}"
NEW="${2:-}"
MODE="${3:-redirect}"
if [ -z "$OLD" ] || [ -z "$NEW" ] || [ "$OLD" = "$NEW" ]; then
  echo "Usage: sudo $0 old-domain new-domain [--remove]"
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$APP_DIR/.env"

# --- the new domain must work before the old one is touched ------------------------------------
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$NEW/app" || true)"
if [ "$CODE" != "200" ]; then
  echo "https://$NEW/app does not answer 200 (answered '$CODE')."
  echo "Deploy the new version first (sudo ./deploy.sh) and publish $NEW (ubuntu-08-setup-landing.sh)."
  exit 1
fi

# --- find the old domain's site (only that one) ------------------------------------------------
SITE_FILE="$(grep -lE "server_name[^;]*[[:space:]]$OLD[[:space:];]" /etc/nginx/sites-available/* 2>/dev/null | head -1 || true)"
if [ -z "$SITE_FILE" ]; then
  echo "No nginx site with server_name $OLD in /etc/nginx/sites-available - nothing to clean up."
else
  SITE_NAME="$(basename "$SITE_FILE")"
  OTHER_NAMES="$(grep -hoE 'server_name[^;]+' "$SITE_FILE" | sed 's/server_name//' | tr ' ' '\n' | grep -v -e '^$' -e "^$OLD$" | sort -u || true)"
  if [ -n "$OTHER_NAMES" ]; then
    echo "Site $SITE_NAME also serves: $OTHER_NAMES - not touching it so other domains are unaffected."
    exit 1
  fi

  BACKUP="/root/nginx-backup-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP"
  cp -a "$SITE_FILE" "$BACKUP/"
  [ -e "/etc/nginx/sites-enabled/$SITE_NAME" ] && cp -a "/etc/nginx/sites-enabled/$SITE_NAME" "$BACKUP/$SITE_NAME.enabled-link" || true
  echo "Backup of $SITE_NAME in $BACKUP"

  restore() {
    echo "nginx -t failed - restoring the previous configuration."
    cp -a "$BACKUP/$SITE_NAME" "$SITE_FILE"
    ln -sf "$SITE_FILE" "/etc/nginx/sites-enabled/$SITE_NAME"
    nginx -t && systemctl reload nginx
    exit 1
  }

  if [ "$MODE" = "--remove" ]; then
    rm -f "/etc/nginx/sites-enabled/$SITE_NAME" "$SITE_FILE"
    nginx -t || restore
    systemctl reload nginx
    if command -v certbot >/dev/null 2>&1 && [ -d "/etc/letsencrypt/live/$OLD" ]; then
      certbot delete --cert-name "$OLD" --non-interactive || echo "(could not delete the certificate of $OLD, harmless)"
    fi
    echo "Removed: $OLD is no longer published. Delete its DNS record at your provider if you want."
  else
    CERT="/etc/letsencrypt/live/$OLD"
    {
      echo "# $OLD -> https://$NEW (Canix unified on a single domain; see deploy/ubuntu-09-unify-domain.sh)"
      echo "server {"
      echo "    listen 80;"
      echo "    listen [::]:80;"
      echo "    server_name $OLD;"
      echo "    location = / { return 301 https://$NEW/app; }"
      echo "    location / { return 301 https://$NEW\$request_uri; }"
      echo "}"
      if [ -f "$CERT/fullchain.pem" ]; then
        echo "server {"
        echo "    listen 443 ssl;"
        echo "    listen [::]:443 ssl;"
        echo "    server_name $OLD;"
        echo "    ssl_certificate $CERT/fullchain.pem;"
        echo "    ssl_certificate_key $CERT/privkey.pem;"
        [ -f /etc/letsencrypt/options-ssl-nginx.conf ] && echo "    include /etc/letsencrypt/options-ssl-nginx.conf;"
        [ -f /etc/letsencrypt/ssl-dhparams.pem ] && echo "    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;"
        echo "    location = / { return 301 https://$NEW/app; }"
        echo "    location / { return 301 https://$NEW\$request_uri; }"
        echo "}"
      fi
    } > "$SITE_FILE"
    ln -sf "$SITE_FILE" "/etc/nginx/sites-enabled/$SITE_NAME"
    nginx -t || restore
    systemctl reload nginx
    echo "Done: $OLD now redirects to https://$NEW (the root to the /app portal)."
  fi
fi

# --- .env: everything points at the new domain ---------------------------------------------------
cp -a "$ENV_FILE" "${BACKUP:-/root}/env.backup-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
for kv in "PANEL_URL=https://$NEW" "LANDING_URL=https://$NEW"; do
  key="${kv%%=*}"
  if grep -q "^$key=" "$ENV_FILE"; then sed -i "s#^$key=.*#$kv#" "$ENV_FILE"; else echo "$kv" >> "$ENV_FILE"; fi
done
echo "PANEL_URL and LANDING_URL = https://$NEW"

if systemctl cat canix.service >/dev/null 2>&1; then
  systemctl restart canix
  echo "Bot restarted."
fi

echo ""
echo "== Verification =="
sleep 4
for u in "https://$NEW/" "https://$NEW/app" "https://$OLD/"; do
  printf '%-45s -> %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 8 "$u" || echo error)"
done
