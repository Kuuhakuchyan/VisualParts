#!/usr/bin/env bash
set -euo pipefail
release=$(cd -- "$(dirname -- "$0")" && pwd)
app=/root/microclimate-decision
site=/var/www/microclimate-decision
backup="/root/weather_backups/$(basename "$release")"
python="$app/.venv/bin/python"
(cd "$release" && sha256sum -c release.sha256 > /dev/null)
mapfile -t runtime < <("$python" -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1]))["runtime"]))' "$release/manifest.json")
mapfile -t models < <("$python" -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1])).get("models",[])),end="")' "$release/manifest.json")
mapfile -t data < <("$python" -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1])).get("data",[])),end="")' "$release/manifest.json")
stage=$(mktemp -d /tmp/platform-quality-test.XXXXXX)
cp -a "$app/backend" "$app/public" "$app/models" "$stage/"
rsync -a --exclude=__pycache__ "$release/backend/" "$stage/backend/"
if [[ -d "$release/models" ]]; then rsync -a "$release/models/" "$stage/models/"; fi
if [[ -d "$release/public/data" ]]; then rsync -a "$release/public/data/" "$stage/public/data/"; fi
(cd "$stage" && AIC_STATE_DB="$stage/evidence.sqlite3" WORKSPACE_STATE_DB="$stage/plans.sqlite3" AIC_DEEPSEEK_API_KEY='' "$python" -W ignore::DeprecationWarning -m unittest discover -s backend -t . -q) > "$release/staged-tests.log" 2>&1
tail -n 5 "$release/staged-tests.log"
[[ ! -e "$backup" ]]
mkdir -p "$backup/backend" "$backup/aic" "$backup/models"
mkdir -p "$backup/data" "$backup/site-data" "$app/public/data" "$site/data"
for file in "${data[@]}"; do
  if [[ -f "$app/public/data/$file" ]]; then cp -a "$app/public/data/$file" "$backup/data/$file"; fi
  if [[ -f "$site/data/$file" ]]; then cp -a "$site/data/$file" "$backup/site-data/$file"; fi
done
for file in "${runtime[@]}"; do mkdir -p "$backup/backend/$(dirname "$file")"; if [[ -f "$app/backend/$file" ]]; then cp -a "$app/backend/$file" "$backup/backend/$file"; fi; done
for file in "${models[@]}"; do if [[ -f "$app/models/$file" ]]; then cp -a "$app/models/$file" "$backup/models/$file"; fi; done
for name in index.html release.json; do if [[ -f "$site/$name" ]]; then cp -a "$site/$name" "$backup/$name"; fi; done
cp -a "$site/aic/index.html" "$backup/aic/index.html"
cp -a "$site/ui-fonts" "$backup/ui-fonts"
rollback(){
  trap - ERR
  for file in "${runtime[@]}"; do if [[ -f "$backup/backend/$file" ]]; then cp "$backup/backend/$file" "$app/backend/$file"; else rm -f -- "$app/backend/$file"; fi; done
  for file in "${models[@]}"; do if [[ -f "$backup/models/$file" ]]; then cp "$backup/models/$file" "$app/models/$file"; else rm -f -- "$app/models/$file"; fi; done
  for file in "${data[@]}"; do
    if [[ -f "$backup/data/$file" ]]; then cp "$backup/data/$file" "$app/public/data/$file"; else rm -f -- "$app/public/data/$file"; fi
    if [[ -f "$backup/site-data/$file" ]]; then cp "$backup/site-data/$file" "$site/data/$file"; else rm -f -- "$site/data/$file"; fi
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
for file in "${models[@]}"; do cp "$release/models/$file" "$app/models/$file"; done
for file in "${data[@]}"; do cp "$release/public/data/$file" "$app/public/data/$file"; cp "$release/public/data/$file" "$site/data/$file"; done
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
printf 'Published platform quality release; backup=%s; staged tests=%s\n' "$backup" "$stage"
