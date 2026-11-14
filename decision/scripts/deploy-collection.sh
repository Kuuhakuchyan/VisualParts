#!/usr/bin/env bash
set -euo pipefail
release=$(cd -- "$(dirname -- "$0")/.." && pwd)
site=/var/www/microclimate-decision
app=/root/microclimate-decision
python="$app/.venv/bin/python"
backup=/root/weather_backups/collection-$(date +%Y%m%d-%H%M%S)
mkdir -p "$backup" "$app/public/data"
cp -a "$site/index.html" "$backup/index.html"
cp -a "$site/aic/index.html" "$backup/aic-index.html"
cp -a "$app/backend/main.py" "$backup/main.py"
cp -a "$app/backend/data_contract.py" "$backup/data_contract.py"
for item in collection.py; do
  if [[ -f "$app/backend/$item" ]]; then cp -a "$app/backend/$item" "$backup/$item"; else touch "$backup/$item.absent"; fi
done
if [[ -f "$app/public/data/campus-streets.geojson" ]]; then cp -a "$app/public/data/campus-streets.geojson" "$backup/backend-streets.geojson"; else touch "$backup/backend-streets.absent"; fi
rollback() {
  cp "$backup/index.html" "$site/index.html"
  cp "$backup/aic-index.html" "$site/aic/index.html"
  cp "$backup/main.py" "$app/backend/main.py"
  cp "$backup/data_contract.py" "$app/backend/data_contract.py"
  if [[ -f "$backup/collection.py.absent" ]]; then rm -f "$app/backend/collection.py"; else cp "$backup/collection.py" "$app/backend/collection.py"; fi
  if [[ -f "$backup/backend-streets.absent" ]]; then rm -f "$app/public/data/campus-streets.geojson"; else cp "$backup/backend-streets.geojson" "$app/public/data/campus-streets.geojson"; fi
  systemctl restart microclimate-decision-api.service
  printf 'Rolled back collection release. Backup: %s\n' "$backup" >&2
}
trap rollback ERR
cp "$release/backend/collection.py" "$app/backend/collection.py"
cp "$release/backend/data_contract.py" "$app/backend/data_contract.py"
cp "$release/dist/data/campus-streets.geojson" "$app/public/data/campus-streets.geojson"
"$python" - "$app/backend/main.py" <<'PY'
import sys
from pathlib import Path
p=Path(sys.argv[1])
text=p.read_text(encoding='utf-8')
marker='app.include_router(sandbox_router)'
addition='\nfrom backend.collection import router as collection_router\napp.include_router(collection_router)'
if 'app.include_router(collection_router)' not in text:
    assert text.count(marker)==1, 'Unexpected application router anchor'
    p.write_text(text.replace(marker,marker+addition),encoding='utf-8')
PY
cd "$app"
"$python" -m py_compile backend/collection.py backend/data_contract.py backend/main.py
"$python" -c 'from backend.main import app; from backend.data_contract import contract; assert any(r.path=="/api/weather/sandbox/collection/simulate" for r in app.routes); assert contract()["collection_simulation"]["med_eligible"] is False'
rsync -a "$release/dist/assets/" "$site/assets/"
systemctl restart microclimate-decision-api.service
ready=0
for attempt in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3100/api/weather/sandbox/lcz-metadata -o "$backup/health.json"; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]]
curl -fsS --max-time 25 http://127.0.0.1:3100/api/weather/sandbox/collection/devices -o "$backup/devices.json"
"$python" -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["read_only"] and len(d["devices"])==2; assert all(x["simulated"] is False for x in d["devices"])' "$backup/devices.json"
cp "$release/dist/index.html" "$site/index.html"
cp "$release/dist/aic/index.html" "$site/aic/index.html"
systemctl is-active microclimate-decision-api.service
sha256sum "$site/index.html" "$site/aic/index.html" "$app/backend/collection.py" "$app/backend/data_contract.py"
trap - ERR
printf 'Deployed anonymous vector streets, concise presentation and collection simulation. Existing weather, scenes, IoT ingestion, nginx, databases and secrets retained. Backup: %s\n' "$backup"
