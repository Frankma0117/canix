#!/usr/bin/env bash
# Daily backup of Canix: consistent SQLite copy (online backup API) + WhatsApp session (auth_info).
# Keeps BACKUP_KEEP_DAYS (default 7) in data/backups/. Run from anywhere:
#   bash /opt/canix/scripts/backup.sh
# Cron (crontab of manuel; server clock is Europe, so check the Bogotá hour every hour):
#   0 * * * * [ "$(TZ=America/Bogota date +\%H)" = 04 ] && bash /opt/canix/scripts/backup.sh >> /opt/canix/data/backup.log 2>&1
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
keep="${BACKUP_KEEP_DAYS:-7}"
d="$(TZ=America/Bogota date +%F)"
out="data/backups"; mkdir -p "$out"

# Consistent copy even while the bot is writing (better-sqlite3 backup API).
(cd backend && node -e "
const Database = require('better-sqlite3');
const db = new Database('../data/app.db', { readonly: true });
db.backup('../$out/app-$d.db').then(() => { db.close(); }).catch(e => { console.error(e); process.exit(1); });
")
gzip -f "$out/app-$d.db"
gzip -t "$out/app-$d.db.gz"

# WhatsApp session: losing it means re-scanning the QR.
if [ -d auth_info ]; then tar -czf "$out/auth-$d.tar.gz" auth_info; chmod 600 "$out/auth-$d.tar.gz"; fi

find "$out" -type f \( -name 'app-*.db.gz' -o -name 'auth-*.tar.gz' \) -mtime +$((keep - 1)) -delete
echo "$(date) backup OK: $(ls "$out" | wc -l) files"
