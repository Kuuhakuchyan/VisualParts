#!/usr/bin/env bash
set -euo pipefail
release=$(cd -- "$(dirname -- "$0")/.." && pwd)
target=/root/microclimate-decision
site=/var/www/microclimate-decision
backup=/root/weather_backups/lcz-$(date +%Y%m%d-%H%M%S)
python="$target/.venv/bin/python"
files=(lcz.py data_contract.py sandbox.py aic/risk.py aic/regional.py aic/router.py aic/generation.py)
assets=(campus-lcz-simulation.geojson reference-station.json)
mkdir -p "$backup"
cp -a "$target/backend" "$backup/backend"
cp -a "$target/public" "$backup/public"
cp -a "$site/index.html" "$backup/index.html"
cp -a "$site/aic/index.html" "$backup/aic-index.html"
printf 'Backup: %s\n' "$backup"
cd "$release"
AIC_STATE_DB="$release/test-state/evidence.sqlite3" WORKSPACE_STATE_DB="$release/test-state/plans.sqlite3" \
  "$python" -W ignore::DeprecationWarning -m unittest backend.test_lcz backend.test_spatial backend.test_sandbox \
  backend.test_planning backend.aic.test_aic backend.aic.test_weather backend.aic.test_regional -q
rollback() {
  rsync -a --delete "$backup/backend/" "$target/backend/"
  rsync -a --delete "$backup/public/" "$target/public/"
  cp "$backup/index.html" "$site/index.html"
  cp "$backup/aic-index.html" "$site/aic/index.html"
  systemctl restart microclimate-decision-api.service
  printf 'Rolled back: %s\n' "$backup" >&2
}
trap rollback ERR
for file in "${files[@]}"; do cp "$release/backend/$file" "$target/backend/$file"; done
for asset in "${assets[@]}"; do cp "$release/public/data/$asset" "$target/public/data/$asset"; done
systemctl restart microclimate-decision-api.service
ready=0
for attempt in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3100/api/weather/sandbox/lcz-metadata -o "$backup/lcz-health.json"; then ready=1; break; fi
  sleep 1
done
test "$ready" = 1
"$python" -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["model_version"]=="lcz-midpoint-scenario-1.0"; assert d["reference_station"]["location_status"]=="user_map_pin"; assert d["reference_station"]["telemetry_status"]=="not_connected"' "$backup/lcz-health.json"
rsync -a "$release/dist/assets/" "$site/assets/"
cp "$release/dist/index.html" "$site/index.html"
cp "$release/dist/aic/index.html" "$site/aic/index.html"
for asset in "${assets[@]}"; do cp "$release/public/data/$asset" "$site/data/$asset"; done
curl -fsS http://127.0.0.1:3100/api/weather/sandbox/data-contract -o "$backup/data-contract.json"
systemctl is-active microclimate-decision-api.service
trap - ERR
printf 'Deployed LCZ simulation. Backup: %s\n' "$backup"
