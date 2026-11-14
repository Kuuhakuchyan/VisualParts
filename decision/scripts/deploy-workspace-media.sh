#!/usr/bin/env bash
set -euo pipefail
release=$(cd -- "$(dirname -- "$0")" && pwd)
project=/var/www/microclimate-decision
competition=/var/www/microclimate-aic
backup="/root/weather_backups/$(basename "$release")"
[[ ! -e "$backup" ]]
mkdir -p "$backup"
cp "$project/index.html" "$backup/project-index.html"
cp "$competition/aic/index.html" "$backup/competition-index.html"
rollback() {
  cp "$backup/project-index.html" "$project/index.html"
  cp "$backup/competition-index.html" "$competition/aic/index.html"
}
trap rollback ERR
for edition in project competition; do
  destination="$project"
  [[ "$edition" != competition ]] || destination="$competition"
  rsync -a "$release/$edition/assets/" "$destination/assets/"
done
install -m 644 "$release/project/index.html" "$project/index.html.next"
install -m 644 "$release/competition/index.html" "$competition/aic/index.html.next"
mv "$project/index.html.next" "$project/index.html"
mv "$competition/aic/index.html.next" "$competition/aic/index.html"
for origin in https://weather.nogamenolife.cn/decision https://aic.nogamenolife.cn; do
  for image in d-intervention.png d-context.png; do
    [[ "$(curl -fsS -o /dev/null -w '%{content_type}' "$origin/assets/workspace-media/$image")" == image/png ]]
  done
done
[[ "$(curl -s -o /dev/null -w '%{http_code}' https://weather.nogamenolife.cn/decision/aic/)" == 404 ]]
trap - ERR
printf 'Workspace media fixed. Backup: %s\n' "$backup"
