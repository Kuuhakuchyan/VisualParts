#!/usr/bin/env bash
set -euo pipefail
release=$(cd -- "$(dirname -- "$0")" && pwd)
old=/root/microclimate-decision
app=/root/microclimate-aic
site=/var/www/microclimate-aic
backup=/root/weather_backups/$(basename "$release")
(cd "$release" && sha256sum -c release.sha256 >/dev/null)
[[ ! -e "$backup" ]]
mkdir -p "$backup" "$app/state" "$site"
cp /etc/nginx/sites-available/aic "$backup/aic.conf"
cp /etc/nginx/sites-available/weather "$backup/weather.conf"
cp /var/www/microclimate-decision/index.html "$backup/project-index.html"
if [[ ! -d "$app/.venv" ]]; then cp -a "$old/.venv" "$app/.venv"; fi
rsync -a --exclude=__pycache__ "$release/backend/" "$app/backend/"
rsync -a "$release/models/" "$app/models/"
mkdir -p "$app/public/data"
rsync -a "$release/public/data/" "$app/public/data/"
for name in sources review-private; do
  if [[ ! -d "$app/state/$name" ]]; then cp -a "$old/aic_state/$name" "$app/state/$name"; fi
done
python="$app/.venv/bin/python"
(cd "$app" && AIC_STATE_DB=/tmp/aic-isolation-tests.sqlite3 WORKSPACE_STATE_DB=/tmp/aic-isolation-plans.sqlite3 AIC_DEEPSEEK_API_KEY='' "$python" -W ignore::DeprecationWarning -m unittest discover -s backend -t . -q) > "$release/tests.log" 2>&1
tail -n 5 "$release/tests.log"
"$python" "$release/configure.py" "$release"
systemctl daemon-reload
systemctl enable --now microclimate-aic-api.service
ready=0
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3102/api/weather/aic/status -o /dev/null; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]]
rsync -a "$release/aic-site/" "$site/"
cp "$release/release.json" "$site/release.json"
rsync -a "$release/project-site/" /var/www/microclimate-decision/
cp "$release/aic.conf" /etc/nginx/sites-available/aic
if ! nginx -t; then
  cp "$backup/aic.conf" /etc/nginx/sites-available/aic
  cp "$backup/weather.conf" /etc/nginx/sites-available/weather
  cp "$backup/project-index.html" /var/www/microclimate-decision/index.html
  exit 1
fi
systemctl reload nginx
systemctl is-active microclimate-aic-api.service microclimate-decision-api.service nginx
printf 'Independent AIC deployed: %s\n' "$(basename "$release")"
