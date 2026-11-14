#!/usr/bin/env bash
set -euo pipefail
release=$(cd -- "$(dirname -- "$0")" && pwd)
site=/var/www/microclimate-decision
blog=/var/www/weather-author
app=/root/weather
backup="/root/weather_backups/$(basename "$release")"
[[ ! -e "$backup" ]]
(cd "$release" && sha256sum -c release.sha256 > /dev/null)
python3 -m py_compile "$release/api/app.py"
mkdir -p "$backup"
cp -a "$site" "$backup/decision"
cp -a "$blog" "$backup/blog"
cp -a "$app/api" "$backup/api"
cp -a /etc/nginx/sites-available/weather "$backup/nginx-weather"
if [[ -f /etc/nginx/sites-available/aic ]]; then cp -a /etc/nginx/sites-available/aic "$backup/nginx-aic"; fi
old_image="weather-api:rollback-$(basename "$release")"
docker tag weather-api:latest "$old_image"
printf '%s\n' "$old_image" > "$backup/api-image.txt"

rollback() {
  trap - ERR
  rsync -a --delete "$backup/decision/" "$site/"
  rsync -a --delete "$backup/blog/" "$blog/"
  rsync -a --delete "$backup/api/" "$app/api/"
  cp -a "$backup/nginx-weather" /etc/nginx/sites-available/weather
  if [[ -f "$backup/nginx-aic" ]]; then cp -a "$backup/nginx-aic" /etc/nginx/sites-available/aic; fi
  nginx -t && systemctl reload nginx
  docker tag "$old_image" weather-api:latest
  (cd "$app" && docker compose up -d --no-deps --no-build api)
  printf 'UI release rolled back; backup=%s\n' "$backup" >&2
}
trap 'result=$?; rollback; exit "$result"' ERR

# Install shared and hashed resources before replacing entry documents.
rsync -a "$release/decision/assets/" "$site/assets/"
rsync -a "$release/decision/aic/assets/" "$site/aic/assets/"
rsync -a "$release/decision/ui-fonts/" "$site/ui-fonts/"
rsync -a "$release/blog/" "$blog/"
rsync -a "$release/api/" "$app/api/"
(cd "$app" && docker compose build api && docker compose up -d --no-deps --no-build api)
ready=0
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/health -o /dev/null; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]]
rsync -a "$release/decision/aic/" "$site/aic/"
install -m 644 "$release/decision/logo.png" "$site/logo.png"
install -m 644 "$release/decision/release.json" "$site/release.json"
install -m 644 "$release/decision/index.html" "$site/index.html.next"
mv "$site/index.html.next" "$site/index.html"
install -m 644 "$release/nginx/aic.conf" /etc/nginx/sites-available/aic
ln -sfn /etc/nginx/sites-available/aic /etc/nginx/sites-enabled/aic
# Nginx expiry covers both directory entries and explicitly requested HTML.
python3 - /etc/nginx/sites-available/weather <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
source = path.read_text()
needle = '    location /decision/ {\n        alias /var/www/microclimate-decision/;'
if needle in source:
    source = source.replace(needle, '    location /decision/assets/ {\n        alias /var/www/microclimate-decision/assets/;\n        expires 1y;\n    }\n\n' + needle + '\n        expires -1;', 1)
path.write_text(source)
PY
nginx -t
systemctl reload nginx
curl -fsS https://weather.nogamenolife.cn/decision/release.json -o "$backup/deployed-release.json"
ready=0
for attempt in $(seq 1 15); do
  if curl -fsS https://aic.nogamenolife.cn/api/weather/aic/status -o "$backup/aic-status.json"; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]]
systemctl is-active nginx microclimate-decision-api.service
trap - ERR
printf 'Complete UI release deployed; backup=%s\n' "$backup"
