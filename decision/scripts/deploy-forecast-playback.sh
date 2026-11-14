#!/usr/bin/env bash
set -euo pipefail
release=$(cd -- "$(dirname -- "$0")" && pwd)
cd "$release"
sha256sum -c release.sha256 >/dev/null
site=/var/www/microclimate-decision
competition=/var/www/microclimate-aic
test -f "$site/index.html"
test -f "$site/aic/index.html"
test -f "$competition/aic/index.html"
backup=/root/weather_backups/$(basename -- "$release")-$(date +%Y%m%d-%H%M%S)
mkdir -p "$backup"
cp "$site/index.html" "$backup/index.html"
cp "$site/aic/index.html" "$backup/aic-index.html"
cp "$competition/aic/index.html" "$backup/competition-index.html"
if [ -f "$site/release.json" ]; then cp "$site/release.json" "$backup/release.json"; fi
if [ -f "$competition/release.json" ]; then cp "$competition/release.json" "$backup/competition-release.json"; fi
rollback(){
  cp "$backup/index.html" "$site/index.html"
  cp "$backup/aic-index.html" "$site/aic/index.html"
  cp "$backup/competition-index.html" "$competition/aic/index.html"
  if [ -f "$backup/release.json" ]; then cp "$backup/release.json" "$site/release.json"; fi
  if [ -f "$backup/competition-release.json" ]; then cp "$backup/competition-release.json" "$competition/release.json"; fi
}
trap rollback ERR
rsync -a "$release/dist/assets/" "$site/assets/"
rsync -a "$release/competition-dist/assets/" "$competition/assets/"
cp "$release/dist/index.html" "$site/index.html.next"
cp "$release/dist/aic/index.html" "$site/aic/index.html.next"
cp "$release/competition-dist/aic/index.html" "$competition/aic/index.html.next"
cp "$release/release.json" "$site/release.json.next"
cp "$release/release.json" "$competition/release.json.next"
mv "$site/index.html.next" "$site/index.html"
mv "$site/aic/index.html.next" "$site/aic/index.html"
mv "$competition/aic/index.html.next" "$competition/aic/index.html"
mv "$site/release.json.next" "$site/release.json"
mv "$competition/release.json.next" "$competition/release.json"
sha256sum "$site/index.html" "$site/aic/index.html" "$competition/aic/index.html"
trap - ERR
printf 'Decision frontend deployed. Backup: %s\n' "$backup"
