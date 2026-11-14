#!/usr/bin/env bash
set -euo pipefail
release=$(cd -- "$(dirname -- "$0")/.." && pwd)
target=/root/microclimate-decision
site=/var/www/microclimate-decision
backup=/root/weather_backups/grid-click-$(date +%Y%m%d-%H%M%S)
mkdir -p "$backup"
cp -a "$site/index.html" "$backup/index.html"
cp -a "$site/aic/index.html" "$backup/aic-index.html"
cp -a "$target/public/data/reference-station.json" "$backup/api-reference-station.json"
cp -a "$site/data/reference-station.json" "$backup/site-reference-station.json"
printf 'Backup: %s\n' "$backup"
rollback() {
  cp "$backup/api-reference-station.json" "$target/public/data/reference-station.json"
  cp "$backup/site-reference-station.json" "$site/data/reference-station.json"
  cp "$backup/index.html" "$site/index.html"
  cp "$backup/aic-index.html" "$site/aic/index.html"
  printf 'Rolled back: %s\n' "$backup" >&2
}
trap rollback ERR
rsync -a "$release/dist/assets/" "$site/assets/"
cp "$release/public/data/reference-station.json" "$target/public/data/reference-station.json"
cp "$release/public/data/reference-station.json" "$site/data/reference-station.json"
curl -fsS http://127.0.0.1:3100/api/weather/sandbox/lcz-metadata -o "$backup/lcz-health.json"
"$target/.venv/bin/python" -c 'import json,sys; s=json.load(open(sys.argv[1]))["reference_station"]; assert s["label"]=="基准站"; assert s["location"]=={"longitude":113.5323459,"latitude":34.8145206}; assert s["telemetry_status"]=="not_connected"' "$backup/lcz-health.json"
cp "$release/dist/index.html" "$site/index.html"
cp "$release/dist/aic/index.html" "$site/aic/index.html"
systemctl is-active microclimate-decision-api.service
trap - ERR
printf 'Deployed grid display/click fixes without changing runtime code, databases or secrets. Backup: %s\n' "$backup"
