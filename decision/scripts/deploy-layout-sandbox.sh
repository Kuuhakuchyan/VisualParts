#!/usr/bin/env bash
set -euo pipefail

# Run in the uploaded staging directory; retain evidence, reviews and secrets.
release_dir=$(cd -- "$(dirname -- "$0")/.." && pwd)
target=/root/microclimate-decision
site=/var/www/microclimate-decision
stamp=$(date +%Y%m%d-%H%M%S)
backup=/root/weather_backups/layout-$stamp
mkdir -p "$backup"
cp -a "$target/backend" "$backup/backend"
cp -a "$site" "$backup/site"
"$target/.venv/bin/python" -m pip freeze > "$backup/requirements-before.txt"
if [[ -d "$target/public" ]]; then cp -a "$target/public" "$backup/public"; fi
printf 'Backup: %s\n' "$backup"

# Dependency failure leaves the running code and static entrypoints untouched.
"$target/.venv/bin/python" -m pip install -r "$release_dir/backend/requirements.txt"
"$target/.venv/bin/python" -m pip check
cd "$release_dir"
"$target/.venv/bin/python" -W error::ResourceWarning -W ignore::DeprecationWarning -m unittest \
  backend.test_spatial backend.test_sandbox backend.test_planning backend.aic.test_aic backend.aic.test_weather backend.aic.test_regional -q

rollback() {
  rsync -a --delete "$backup/backend/" "$target/backend/"
  rsync -a --delete "$backup/site/" "$site/"
  if [[ -d "$backup/public" ]]; then rsync -a --delete "$backup/public/" "$target/public/"; fi
  systemctl restart microclimate-decision-api.service
  printf 'Release failed; restored code and site from %s\n' "$backup" >&2
}
trap rollback ERR
rsync -a --exclude=__pycache__ "$release_dir/backend/" "$target/backend/"
mkdir -p "$target/public/data"
cp "$release_dir/public/data/campus-buildings.geojson" "$target/public/data/campus-buildings.geojson"
cp "$release_dir/public/data/campus-boundary.geojson" "$target/public/data/campus-boundary.geojson"
systemctl restart microclimate-decision-api.service
ready=0
for attempt in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3100/api/weather/sandbox/buildings -o "$backup/buildings-health.json"; then ready=1; break; fi
  sleep 1
done
test "$ready" = 1
"$target/.venv/bin/python" -c 'import json,sys; d=json.load(open(sys.argv[1])); assert len(d["features"])>=205 and not d["coverage"]["complete_survey"]' "$backup/buildings-health.json"
# Keep old hashed assets for already-open clients; do not delete public data.
rsync -a "$release_dir/dist/" "$site/"
curl -fsS http://127.0.0.1:3100/health -o "$backup/api-health.json"
systemctl is-active microclimate-decision-api.service
trap - ERR
printf 'Deployed layout sandbox; rollback backup: %s\n' "$backup"
