#!/usr/bin/env bash
set -euo pipefail
release=$(cd -- "$(dirname -- "$0")/.." && pwd)
app=/root/microclimate-decision
site=/var/www/microclimate-decision
python="$app/.venv/bin/python"
backup=/root/weather_backups/decision-$(date +%Y%m%d-%H%M%S)
files=(main.py hybrid.py sandbox.py aic/generation.py aic/regional.py aic/router.py aic/decision.py aic/decision_sources.json)
mkdir -p "$backup/backend/aic"
cp -a "$site/index.html" "$backup/index.html"
cp -a "$site/aic/index.html" "$backup/aic-index.html"
for file in "${files[@]}"; do
  if [[ -f "$app/backend/$file" ]]; then cp -a "$app/backend/$file" "$backup/backend/$file"; else touch "$backup/backend/$file.absent"; fi
done
rollback(){
  for file in "${files[@]}"; do
    if [[ -f "$backup/backend/$file.absent" ]]; then rm -f "$app/backend/$file"; else cp "$backup/backend/$file" "$app/backend/$file"; fi
  done
  cp "$backup/index.html" "$site/index.html"
  cp "$backup/aic-index.html" "$site/aic/index.html"
  systemctl restart microclimate-decision-api.service
  printf 'Decision release rolled back. Backup: %s\n' "$backup" >&2
}
trap rollback ERR
for file in "${files[@]}"; do cp "$release/backend/$file" "$app/backend/$file"; done
cd "$app"
"$python" -m py_compile backend/main.py backend/hybrid.py backend/sandbox.py backend/aic/generation.py backend/aic/regional.py backend/aic/router.py backend/aic/decision.py
"$python" -c 'from backend.main import app; from backend.aic.decision import background_records; assert len(background_records())>=4; assert any(r.path=="/api/weather/sandbox/collaborate" for r in app.routes)'
rsync -a "$release/dist/assets/" "$site/assets/"
systemctl restart microclimate-decision-api.service
ready=0
for attempt in $(seq 1 25); do
  if curl -fsS http://127.0.0.1:3100/api/weather/aic/status -o "$backup/api-status.json"; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]]
cp "$release/dist/index.html" "$site/index.html"
cp "$release/dist/aic/index.html" "$site/aic/index.html"
systemctl is-active microclimate-decision-api.service
sha256sum "$site/index.html" "$site/aic/index.html" "$app/backend/aic/decision.py" "$app/backend/aic/decision_sources.json"
trap - ERR
printf 'Grounded AI area and building judgements deployed. Backup: %s\n' "$backup"
