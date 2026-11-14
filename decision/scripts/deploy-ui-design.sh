#!/usr/bin/env bash
set -euo pipefail
release=$(cd -- "$(dirname -- "$0")" && pwd)
site=/var/www/microclimate-decision
blog=/var/www/weather-author
app=/root/weather
backup="/root/weather_backups/$(basename "$release")"
[[ ! -e "$backup" ]]
mkdir -p "$backup"
cp -a "$site" "$backup/decision"
cp -a "$blog" "$backup/blog"
cp -a "$app/api" "$backup/api"
old_image=$(docker inspect iot_api --format '{{.Image}}')
printf '%s\n' "$old_image" > "$backup/api-image.txt"

rollback() {
  trap - ERR
  rsync -a --delete "$backup/decision/" "$site/"
  rsync -a --delete "$backup/blog/" "$blog/"
  rsync -a --delete "$backup/api/" "$app/api/"
  docker tag "$old_image" weather-api:latest
  (cd "$app" && docker compose up -d --no-deps --no-build api)
  printf 'UI release rolled back. Backup: %s\n' "$backup" >&2
}
trap 'result=$?; rollback; exit "$result"' ERR

rsync -a "$release/api/templates/" "$app/api/templates/"
rsync -a "$release/api/static/" "$app/api/static/"
python3 - "$app/api/app.py" <<'PY'
import ast
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
source = path.read_text()
tree = ast.parse(source)
function = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == 'home_asset')
condition = next(node for node in function.body if isinstance(node, ast.If))
allowed = condition.test.comparators[0]
assert isinstance(allowed, ast.Set)
names = ast.literal_eval(allowed)
additions = sorted({'author.css', 'design.css', 'scene.js', 'scene.json'} - names)
if additions:
    old = ast.get_source_segment(source, allowed)
    new = old[:-1].rstrip().rstrip(',') + ', ' + ', '.join(repr(name) for name in additions) + '}'
    assert source.count(old) == 1
    source = source.replace(old, new, 1)
    ast.parse(source)
    path.write_text(source)
PY
python3 -m py_compile "$app/api/app.py"

# Hashed resources are installed before HTML that references them.
rsync -a "$release/decision/assets/" "$site/assets/"
rsync -a "$release/decision/aic/assets/" "$site/aic/assets/"
rsync -a "$release/decision/ui-fonts/" "$site/ui-fonts/"
rsync -a "$release/blog/_astro/" "$blog/_astro/"
rsync -a "$release/blog/project/" "$blog/project/"
(cd "$app" && docker compose build api && docker compose up -d --no-deps --no-build api)
ready=0
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/health -o /dev/null && curl -fsS http://127.0.0.1:8080/home-assets/design.css -o /dev/null && curl -fsS http://127.0.0.1:8080/home-assets/scene.js -o /dev/null && curl -fsS http://127.0.0.1:8080/home-assets/scene.json -o /dev/null; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]]
for file in aic/home.html aic/journal.html aic/index.html index.html; do
  cp "$release/decision/$file" "$site/$file.next"
  mv "$site/$file.next" "$site/$file"
done
curl -fsS http://127.0.0.1:3100/api/weather/aic/status -o "$backup/decision-api-status.json"
systemctl is-active microclimate-decision-api.service
sha256sum "$site/index.html" "$site/aic/index.html" "$site/aic/home.html" "$app/api/templates/home.html" "$blog/project/index.html"
trap - ERR
printf 'UI release deployed. Backup: %s\n' "$backup"
