#!/usr/bin/env bash
set -euo pipefail
release=$(cd -- "$(dirname -- "$0")/.." && pwd)
source=/root/weather/api/app.py
stamp=$(date +%Y%m%d-%H%M%S)
backup=/root/weather_backups/iot-safety-$stamp
old_image=$(docker inspect -f '{{.Image}}' iot_api)
expected=${EXPECTED_IOT_APP_SHA256:-967199e5fbad33c77b1c66b8f712afa9b29ad34e90ae1952716465d7104aa87c}
[[ "$expected" =~ ^[a-f0-9]{64}$ ]]
[[ $(sha256sum "$source" | cut -d ' ' -f 1) == "$expected" ]]
[[ $(docker exec iot_api sha256sum /app/app.py | cut -d ' ' -f 1) == "$expected" ]]
mkdir -p "$backup"
cp "$source" "$backup/app.py"
docker image tag "$old_image" "weather-api:before-safety-$stamp"
rollback(){
  cp "$backup/app.py" "$source"
  docker image tag "$old_image" weather-api:latest
  (cd /root/weather && docker compose up -d --no-build --no-deps api)
  printf 'IoT release rolled back. Backup: %s\n' "$backup" >&2
}
trap rollback ERR
docker run --rm -i --entrypoint python "$old_image" -c 'import sys; compile(sys.stdin.read(),"app.py","exec")' < "$release/app.py"
cp "$release/app.py" "$source"
printf 'FROM %s\nCOPY app.py /app/app.py\n' "$old_image" > "$backup/Dockerfile"
cp "$release/app.py" "$backup/release-app.py"
mkdir -p "$backup/build"
cp "$release/app.py" "$backup/build/app.py"
docker build -q -t weather-api:latest -f "$backup/Dockerfile" "$backup/build"
(cd /root/weather && docker compose up -d --no-build --no-deps api)
ready=0
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/health -o "$backup/health.json"; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]]
docker exec iot_api python -c 'import app; assert app.app.docs_url is None; assert app.API_WRITE_TOKEN; print("IoT import and write-access configuration verified")'
docker exec iot_api sha256sum /app/app.py
trap - ERR
printf 'IoT safety release deployed. Backup: %s\n' "$backup"
