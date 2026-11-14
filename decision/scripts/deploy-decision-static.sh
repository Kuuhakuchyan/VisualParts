#!/usr/bin/env bash
set -euo pipefail
release=$(cd -- "$(dirname -- "$0")/.." && pwd)
site=/var/www/microclimate-decision
backup=/root/weather_backups/decision-static-$(date +%Y%m%d-%H%M%S)
mkdir -p "$backup"
cp "$site/index.html" "$backup/index.html"
cp "$site/aic/index.html" "$backup/aic-index.html"
rollback(){
  cp "$backup/index.html" "$site/index.html"
  cp "$backup/aic-index.html" "$site/aic/index.html"
}
trap rollback ERR
rsync -a "$release/dist/assets/" "$site/assets/"
cp "$release/dist/index.html" "$site/index.html.next"
cp "$release/dist/aic/index.html" "$site/aic/index.html.next"
mv "$site/index.html.next" "$site/index.html"
mv "$site/aic/index.html.next" "$site/aic/index.html"
sha256sum "$site/index.html" "$site/aic/index.html"
trap - ERR
printf 'Report linkage frontend deployed. Backup: %s\n' "$backup"
