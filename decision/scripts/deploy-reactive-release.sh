#!/usr/bin/env bash
set -euo pipefail
release=$(cd -- "$(dirname -- "$0")/.." && pwd)
site=/var/www/microclimate-decision
app=/root/microclimate-decision
python="$app/.venv/bin/python"
backup=/root/weather_backups/reactive-$(date +%Y%m%d-%H%M%S)
mkdir -p "$backup/backend" "$backup/models" "$app/models"
cp -a "$site/index.html" "$backup/index.html"
cp -a "$site/aic" "$backup/aic"
for file in main.py collection.py data_contract.py routing.py temporal.py; do
  if [[ -f "$app/backend/$file" ]]; then cp -a "$app/backend/$file" "$backup/backend/$file"; else touch "$backup/backend/$file.absent"; fi
done
if [[ -f "$app/models/weather-temporal-ridge.json" ]]; then cp -a "$app/models/weather-temporal-ridge.json" "$backup/models/"; else touch "$backup/models/weather-temporal-ridge.json.absent"; fi
rollback(){
  cp "$backup/index.html" "$site/index.html"
  rsync -a --delete "$backup/aic/" "$site/aic/"
  for file in main.py collection.py data_contract.py routing.py temporal.py; do
    if [[ -f "$backup/backend/$file.absent" ]]; then rm -f "$app/backend/$file"; else cp "$backup/backend/$file" "$app/backend/$file"; fi
  done
  if [[ -f "$backup/models/weather-temporal-ridge.json.absent" ]]; then rm -f "$app/models/weather-temporal-ridge.json"; else cp "$backup/models/weather-temporal-ridge.json" "$app/models/weather-temporal-ridge.json"; fi
  systemctl restart microclimate-decision-api.service
  printf 'Release rolled back. Backup: %s\n' "$backup" >&2
}
trap rollback ERR
"$python" -m pip -q install 'networkx==3.7'
for file in collection.py data_contract.py routing.py temporal.py; do cp "$release/backend/$file" "$app/backend/$file"; done
cp "$release/models/weather-temporal-ridge.json" "$app/models/weather-temporal-ridge.json"
"$python" - "$app/backend/main.py" <<'PY'
import sys
from pathlib import Path
p=Path(sys.argv[1]); text=p.read_text(encoding='utf-8')
marker='app.include_router(collection_router)'
if 'app.include_router(temporal_router)' not in text:
    assert text.count(marker)==1, 'Unexpected router anchor'
    text=text.replace(marker, marker+'\nfrom backend.temporal import router as temporal_router\napp.include_router(temporal_router)')
    p.write_text(text,encoding='utf-8')
PY
cd "$app"
"$python" -m py_compile backend/collection.py backend/routing.py backend/temporal.py backend/main.py
"$python" -c 'from backend.temporal import artifact; assert artifact()["horizon_minutes"]==15; import networkx; assert networkx.__version__=="3.7"'
rsync -a "$release/dist/assets/" "$site/assets/"
rsync -a "$release/dist/aic/assets/" "$site/aic/assets/"
cp "$release/dist/aic/home.html" "$release/dist/aic/journal.html" "$site/aic/"
systemctl restart microclimate-decision-api.service
ready=0
for attempt in $(seq 1 25); do
  if curl -fsS http://127.0.0.1:3100/api/weather/sandbox/temporal/model -o "$backup/model-status.json"; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]]
"$python" -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["sample_counts"]["test"]>0; assert d["deepseek_weights_modified"] is False; assert "coefficients" not in d' "$backup/model-status.json"
cp "$release/dist/index.html" "$site/index.html"
cp "$release/dist/aic/index.html" "$site/aic/index.html"
systemctl is-active microclimate-decision-api.service
sha256sum "$site/index.html" "$site/aic/index.html" "$site/aic/home.html" "$app/models/weather-temporal-ridge.json"
trap - ERR
printf 'Reactive sandbox, camera, informative routes, temporal model and anonymous homepage deployed. Backup: %s\n' "$backup"
