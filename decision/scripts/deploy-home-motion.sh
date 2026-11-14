#!/usr/bin/env bash
set -euo pipefail
release=$(cd -- "$(dirname -- "$0")/.." && pwd)
app=/root/weather
site=/var/www/microclimate-decision
backup="/root/weather_backups/$(basename "$release")"
[[ ! -e "$backup" ]]
(cd "$release" && sha256sum -c release.sha256)
mkdir -p "$backup/api/templates" "$backup/api/static/home" "$backup/aic"
mkdir -p "$backup/aic/assets"
for file in scene.js scene.json; do
  cp -a "$app/api/static/home/$file" "$backup/api/static/home/$file"
  cp -a "$site/aic/assets/$file" "$backup/aic/assets/$file"
done
cp -a "$app/api/templates/home.html" "$backup/api/templates/"
cp -a "$app/api/static/home/design.css" "$backup/api/static/home/"
cp -a "$app/api/app.py" "$backup/api/app.py"
cp -a /etc/nginx/sites-available/weather "$backup/nginx-weather"
cp -a "$site/aic/home.html" "$site/aic/journal.html" "$backup/aic/"
old_image=$(docker inspect iot_api --format '{{.Image}}')
printf '%s\n' "$old_image" > "$backup/api-image.txt"
rollback(){
  trap - ERR
  cp -a "$backup/api/templates/home.html" "$app/api/templates/"
  cp -a "$backup/api/static/home/design.css" "$app/api/static/home/"
  for file in scene.js scene.json; do
    cp -a "$backup/api/static/home/$file" "$app/api/static/home/$file"
    cp -a "$backup/aic/assets/$file" "$site/aic/assets/$file"
  done
  cp -a "$backup/api/app.py" "$app/api/app.py"
  cp -a "$backup/nginx-weather" /etc/nginx/sites-available/weather
  nginx -t && systemctl reload nginx
  cp -a "$backup/aic/home.html" "$backup/aic/journal.html" "$site/aic/"
  docker tag "$old_image" weather-api:latest
  (cd "$app" && docker compose up -d --no-deps --no-build api)
  printf 'Homepage motion release rolled back: %s\n' "$backup" >&2
}
trap 'result=$?; rollback; exit "$result"' ERR
install -m 644 "$release/api/static/home/design.css" "$app/api/static/home/design.css"
install -m 644 "$release/api/templates/home.html" "$app/api/templates/home.html"
for file in scene.js scene.json; do install -m 644 "$release/api/static/home/$file" "$app/api/static/home/$file"; done
python3 "$release/scripts/patch-home-cache.py" "$app/api/app.py" /etc/nginx/sites-available/weather
python3 -m py_compile "$app/api/app.py"
nginx -t
(cd "$app" && docker compose build api && docker compose up -d --no-deps --no-build api)
ready=0
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/health -o /dev/null && curl -fsS http://127.0.0.1:8080/home-assets/design.css -o /dev/null; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]]
for file in scene.js scene.json; do install -m 644 "$release/decision/aic/assets/$file" "$site/aic/assets/$file"; done
for file in home.html journal.html; do
  install -m 644 "$release/decision/aic/$file" "$site/aic/$file.next"
  mv "$site/aic/$file.next" "$site/aic/$file"
done
systemctl reload nginx
systemctl is-active microclimate-decision-api.service
curl -fsS http://127.0.0.1:3100/api/weather/aic/status -o "$backup/decision-api-status.json"
sha256sum "$app/api/templates/home.html" "$app/api/static/home/design.css" "$site/aic/home.html" "$site/aic/journal.html"
trap - ERR
printf 'Homepage motion deployed. Backup: %s\n' "$backup"
