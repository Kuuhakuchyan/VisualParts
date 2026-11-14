#!/usr/bin/env bash
set -euo pipefail
release=$(cd -- "$(dirname -- "$0")/.." && pwd)
site=/var/www/microclimate-decision
app=/root/weather
backup="/root/weather_backups/$(basename "$release")"
[[ ! -e "$backup" ]]
(cd "$release" && sha256sum -c release.sha256)
[[ "$(docker inspect iot_api --format '{{.Config.WorkingDir}}')" == /app ]]
mkdir -p "$backup/dist/aic" "$backup/api/templates"
for file in index.html aic/index.html aic/home.html; do cp -a "$site/$file" "$backup/dist/$file"; done
cp -a "$app/api/templates/home.html" "$backup/api/templates/home.html"
docker cp iot_api:/app/templates/home.html "$backup/container-home.html"
sha256sum "$app/api/app.py" > "$backup/api-code-before.sha256"
rollback() {
  trap - ERR
  for file in index.html aic/index.html aic/home.html; do cp -a "$backup/dist/$file" "$site/$file"; done
  cp -a "$backup/api/templates/home.html" "$app/api/templates/home.html"
  docker cp "$backup/container-home.html" iot_api:/app/templates/home.html
  printf 'Interface release rolled back: %s\n' "$backup" >&2
}
trap 'result=$?; rollback; exit "$result"' ERR
rsync -a "$release/dist/assets/" "$site/assets/"
for file in index.html aic/index.html aic/home.html; do
  install -m 644 "$release/dist/$file" "$site/$file.next"
  mv "$site/$file.next" "$site/$file"
done
install -m 644 "$release/api/templates/home.html" "$app/api/templates/home.html"
docker cp "$release/api/templates/home.html" iot_api:/app/templates/home.html
curl -fsS http://127.0.0.1:8080/ -o "$backup/served-home-after.html"
cmp "$release/api/templates/home.html" "$backup/served-home-after.html"
curl -fsS http://127.0.0.1:8080/health -o /dev/null
systemctl is-active microclimate-decision-api.service
sha256sum -c "$backup/api-code-before.sha256"
sha256sum "$app/api/templates/home.html" "$site/index.html" "$site/aic/index.html" "$site/aic/home.html"
trap - ERR
printf 'Interface copy deployed without restarting backend services. Backup: %s\n' "$backup"
