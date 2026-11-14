#!/usr/bin/env bash
set -euo pipefail
release=$(cd -- "$(dirname -- "$0")" && pwd)
app=/root/microclimate-decision
site=/var/www/microclimate-decision
backup="/root/weather_backups/$(basename "$release")"
runtime=(aic/decision.py aic/generation.py aic/regional.py aic/router.py aic/prevention.py aic/test_prevention.py)
(cd "$release" && sha256sum -c release.sha256 > /dev/null)
[[ ! -e "$backup" ]]
mkdir -p "$backup/backend/aic" "$backup/aic"
for name in index.html release.json; do if [[ -f "$site/$name" ]]; then cp -a "$site/$name" "$backup/$name"; fi; done
cp -a "$site/aic/index.html" "$backup/aic/index.html"
cp -a "$site/ui-fonts" "$backup/ui-fonts"
for file in "${runtime[@]}"; do
  if [[ -f "$app/backend/$file" ]]; then cp -a "$app/backend/$file" "$backup/backend/$file"; else touch "$backup/backend/$file.absent"; fi
done
rollback(){
  trap - ERR
  for file in "${runtime[@]}"; do
    if [[ -f "$backup/backend/$file.absent" ]]; then rm -f "$app/backend/$file"; else cp "$backup/backend/$file" "$app/backend/$file"; fi
  done
  cp "$backup/index.html" "$site/index.html"
  cp "$backup/aic/index.html" "$site/aic/index.html"
  if [[ -f "$backup/release.json" ]]; then cp "$backup/release.json" "$site/release.json"; fi
  rsync -a "$backup/ui-fonts/" "$site/ui-fonts/"
  systemctl restart microclimate-decision-api.service
  printf 'Rolled back; backup=%s\n' "$backup" >&2
}
trap 'result=$?; rollback; exit "$result"' ERR
for file in "${runtime[@]}"; do cp "$release/backend/$file" "$app/backend/$file"; done
cd "$app"
.venv/bin/python -m py_compile backend/aic/decision.py backend/aic/generation.py backend/aic/regional.py backend/aic/router.py backend/aic/prevention.py
.venv/bin/python -m unittest backend.aic.test_prevention -q
.venv/bin/python -c 'from backend.main import app; assert any(r.path=="/api/weather/aic/regional-assess" for r in app.routes)'
rsync -a "$release/dist/assets/" "$site/assets/"
rsync -a "$release/dist/ui-fonts/" "$site/ui-fonts/"
systemctl restart microclimate-decision-api.service
ready=0
for attempt in $(seq 1 25); do
  if curl -fsS http://127.0.0.1:3100/api/weather/aic/status -o /dev/null; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]]
cp "$release/dist/index.html" "$site/index.html.next"
mv "$site/index.html.next" "$site/index.html"
cp "$release/dist/aic/index.html" "$site/aic/index.html.next"
mv "$site/aic/index.html.next" "$site/aic/index.html"
cp "$release/release.json" "$site/release.json"
systemctl is-active microclimate-decision-api.service nginx
trap - ERR
printf 'Published mobile and actionable analysis; backup=%s\n' "$backup"
