#!/usr/bin/env bash
set -euo pipefail
release=$(cd -- "$(dirname -- "$0")" && pwd)
app=/root/microclimate-decision
site=/var/www/microclimate-decision
backup="/root/weather_backups/$(basename "$release")"
python="$app/.venv/bin/python"
(cd "$release" && sha256sum -c release.sha256 > /dev/null)
mapfile -t runtime < <("$python" -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1]))["runtime"]))' "$release/manifest.json")
stage=$(mktemp -d /tmp/forecast-thermal-test.XXXXXX)
cp -a "$app/backend" "$app/public" "$app/models" "$stage/"
rsync -a --exclude=__pycache__ "$release/backend/" "$stage/backend/"
(cd "$stage" && AIC_STATE_DB="$stage/evidence.sqlite3" WORKSPACE_STATE_DB="$stage/plans.sqlite3" AIC_DEEPSEEK_API_KEY='' "$python" -W ignore::DeprecationWarning -m unittest backend.test_forecast_sandbox backend.test_sandbox backend.test_lcz backend.test_hybrid backend.aic.test_aic backend.aic.test_regional backend.aic.test_decision backend.aic.test_prevention -q)
[[ ! -e "$backup" ]]
mkdir -p "$backup/backend/aic" "$backup/aic"
for file in "${runtime[@]}"; do cp -a "$app/backend/$file" "$backup/backend/$file"; done
for name in index.html release.json; do if [[ -f "$site/$name" ]]; then cp -a "$site/$name" "$backup/$name"; fi; done
cp -a "$site/aic/index.html" "$backup/aic/index.html"
cp -a "$site/ui-fonts" "$backup/ui-fonts"
rollback(){
  trap - ERR
  for file in "${runtime[@]}"; do cp "$backup/backend/$file" "$app/backend/$file"; done
  cp "$backup/index.html" "$site/index.html"
  cp "$backup/aic/index.html" "$site/aic/index.html"
  if [[ -f "$backup/release.json" ]]; then cp "$backup/release.json" "$site/release.json"; fi
  rsync -a "$backup/ui-fonts/" "$site/ui-fonts/"
  systemctl restart microclimate-decision-api.service
  printf 'Rolled back; backup=%s\n' "$backup" >&2
}
trap 'result=$?; rollback; exit "$result"' ERR
for file in "${runtime[@]}"; do cp "$release/backend/$file" "$app/backend/$file"; done
rsync -a "$release/dist/assets/" "$site/assets/"
rsync -a "$release/dist/ui-fonts/" "$site/ui-fonts/"
systemctl restart microclimate-decision-api.service
ready=0
for attempt in $(seq 1 25); do
  if curl -fsS http://127.0.0.1:3100/api/weather/aic/status -o /dev/null; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]]
for name in index.html aic/index.html; do cp "$release/dist/$name" "$site/$name.next"; mv "$site/$name.next" "$site/$name"; done
cp "$release/release.json" "$site/release.json"
systemctl is-active microclimate-decision-api.service nginx
trap - ERR
printf 'Published forecast thermal chain; backup=%s; staged tests=%s\n' "$backup" "$stage"
