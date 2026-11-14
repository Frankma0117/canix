#!/usr/bin/env bash
# Detects the bot being down or crash-looping (it went unnoticed for 2 weeks once).
# Logs to data/health.log and, if HEALTHCHECK_PING_URL is set in .env (e.g. a free healthchecks.io
# check), pings it ONLY when everything is fine - the external service alerts you when pings stop.
# Cron (every 5 minutes, crontab of manuel):
#   */5 * * * * bash /opt/canix/scripts/healthcheck.sh >> /opt/canix/data/health.log 2>&1
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ping="$(grep -E '^HEALTHCHECK_PING_URL=' .env 2>/dev/null | cut -d= -f2- || true)"
problem=""
[ "$(systemctl is-active canix 2>/dev/null)" = "active" ] || problem="service not active"
if [ -z "$problem" ]; then
  restarts="$(systemctl show canix -p NRestarts --value 2>/dev/null || echo 0)"
  # more than 5 restarts in the last 10 minutes = crash loop
  recent="$(journalctl -u canix --since '-10min' --no-pager 2>/dev/null | grep -c 'Started canix' || true)"
  [ "${recent:-0}" -le 5 ] || problem="crash loop ($recent starts in 10 min, NRestarts=$restarts)"
fi
if [ -n "$problem" ]; then echo "$(date) PROBLEM: $problem"; exit 1; fi
[ -z "$ping" ] || curl -fsS -m 10 "$ping" >/dev/null || echo "$(date) ping failed"
