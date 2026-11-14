#!/usr/bin/env bash
set -euo pipefail
release=$(cd -- "$(dirname -- "$0")/.." && pwd)
site=/var/www/microclimate-decision
backup=/root/weather_backups/grid-streets-$(date +%Y%m%d-%H%M%S)
mkdir -p "$backup" "$site/data"
cp -a "$site/index.html" "$backup/index.html"
cp -a "$site/aic/index.html" "$backup/aic-index.html"
if [[ -f "$site/data/campus-streets.geojson" ]]; then cp -a "$site/data/campus-streets.geojson" "$backup/campus-streets.geojson"; fi
rollback() {
  cp "$backup/index.html" "$site/index.html"
  cp "$backup/aic-index.html" "$site/aic/index.html"
  if [[ -f "$backup/campus-streets.geojson" ]]; then cp "$backup/campus-streets.geojson" "$site/data/campus-streets.geojson"; fi
  printf 'Rolled back entrypoints: %s\n' "$backup" >&2
}
trap rollback ERR
/root/microclimate-decision/.venv/bin/python -c 'import json,sys; d=json.load(open(sys.argv[1])); assert len(d["features"])==120; assert d["source_metadata"]["crs"]=="EPSG:4326"; assert d["source_metadata"]["survey_verified"] is False; assert all(f["geometry"]["type"] in ("LineString","MultiLineString") for f in d["features"])' "$release/dist/data/campus-streets.geojson"
rsync -a "$release/dist/assets/" "$site/assets/"
cp "$release/dist/data/campus-streets.geojson" "$site/data/campus-streets.geojson.next"
mv "$site/data/campus-streets.geojson.next" "$site/data/campus-streets.geojson"
cp "$release/dist/index.html" "$site/index.html"
cp "$release/dist/aic/index.html" "$site/aic/index.html"
curl -fsS http://127.0.0.1:3100/api/weather/sandbox/lcz-metadata -o "$backup/lcz-health.json"
systemctl is-active microclimate-decision-api.service
sha256sum "$site/data/campus-streets.geojson" "$site/index.html" "$site/aic/index.html"
trap - ERR
printf 'Deployed grid defaults, source/count separation and street display fix. No backend, nginx, database or secrets changed. Backup: %s\n' "$backup"
