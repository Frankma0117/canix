#!/usr/bin/env bash
# Deja TODO Canix en un solo dominio (ej. canix.cania.app: página de venta en "/", portal y
# administración en "/app") y limpia el dominio viejo (ej. virtual-assistant.cania.app):
#   - por defecto lo convierte en REDIRECCIÓN 301 al dominio nuevo (la raíz va a /app, porque los
#     mensajes de contraseña que ya se enviaron apuntan ahí; cualquier otra ruta conserva su camino),
#   - con --remove lo elimina por completo (sitio de nginx + certificado).
# Actualiza PANEL_URL y LANDING_URL en .env y reinicia el bot. NO toca ningún otro sitio de nginx.
# Antes de cambiar nada guarda copia en /root/nginx-backup-<fecha>/.
#
# Uso:
#   sudo ./deploy/ubuntu-09-unify-domain.sh virtual-assistant.cania.app canix.cania.app
#   sudo ./deploy/ubuntu-09-unify-domain.sh virtual-assistant.cania.app canix.cania.app --remove
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Necesita sudo: sudo $0 dominio-viejo dominio-nuevo [--remove]"
  exit 1
fi
OLD="${1:-}"
NEW="${2:-}"
MODE="${3:-redirect}"
if [ -z "$OLD" ] || [ -z "$NEW" ] || [ "$OLD" = "$NEW" ]; then
  echo "Uso: sudo $0 dominio-viejo dominio-nuevo [--remove]"
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$APP_DIR/.env"

# --- el dominio nuevo debe estar funcionando antes de tocar el viejo ---------------------------
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$NEW/app" || true)"
if [ "$CODE" != "200" ]; then
  echo "https://$NEW/app no responde 200 (respondió '$CODE')."
  echo "Primero despliega la versión nueva (sudo ./deploy.sh) y publica $NEW (ubuntu-08-setup-landing.sh)."
  exit 1
fi

# --- localizar el sitio del dominio viejo (solo ese) ------------------------------------------
SITE_FILE="$(grep -lE "server_name[^;]*[[:space:]]$OLD[[:space:];]" /etc/nginx/sites-available/* 2>/dev/null | head -1 || true)"
if [ -z "$SITE_FILE" ]; then
  echo "No encontré un sitio de nginx con server_name $OLD en /etc/nginx/sites-available - nada que limpiar."
else
  SITE_NAME="$(basename "$SITE_FILE")"
  OTHER_NAMES="$(grep -hoE 'server_name[^;]+' "$SITE_FILE" | sed 's/server_name//' | tr ' ' '\n' | grep -v -e '^$' -e "^$OLD$" | sort -u || true)"
  if [ -n "$OTHER_NAMES" ]; then
    echo "El sitio $SITE_NAME también atiende: $OTHER_NAMES - no lo toco para no afectar otros dominios."
    exit 1
  fi

  BACKUP="/root/nginx-backup-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP"
  cp -a "$SITE_FILE" "$BACKUP/"
  [ -e "/etc/nginx/sites-enabled/$SITE_NAME" ] && cp -a "/etc/nginx/sites-enabled/$SITE_NAME" "$BACKUP/$SITE_NAME.enabled-link" || true
  echo "Respaldo de $SITE_NAME en $BACKUP"

  restore() {
    echo "nginx -t falló - restauro la configuración anterior."
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
      certbot delete --cert-name "$OLD" --non-interactive || echo "(no pude borrar el certificado de $OLD, no afecta nada)"
    fi
    echo "Eliminado: $OLD ya no está publicado. Recuerda borrar su registro DNS en Hostinger si quieres."
  else
    CERT="/etc/letsencrypt/live/$OLD"
    {
      echo "# $OLD -> https://$NEW (Canix unificado en un solo dominio; ver deploy/ubuntu-09-unify-domain.sh)"
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
    echo "Listo: $OLD ahora redirige a https://$NEW (la raíz al portal /app)."
  fi
fi

# --- .env: todo apunta al dominio nuevo --------------------------------------------------------
cp -a "$ENV_FILE" "${BACKUP:-/root}/env.backup-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
for kv in "PANEL_URL=https://$NEW" "LANDING_URL=https://$NEW"; do
  key="${kv%%=*}"
  if grep -q "^$key=" "$ENV_FILE"; then sed -i "s#^$key=.*#$kv#" "$ENV_FILE"; else echo "$kv" >> "$ENV_FILE"; fi
done
echo "PANEL_URL y LANDING_URL = https://$NEW"

if systemctl cat canix.service >/dev/null 2>&1; then
  systemctl restart canix
  echo "Bot reiniciado."
fi

echo ""
echo "== Verificación =="
sleep 4
for u in "https://$NEW/" "https://$NEW/app" "https://$OLD/"; do
  printf '%-45s -> %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 8 "$u" || echo error)"
done
