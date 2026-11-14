#!/usr/bin/env bash
set -euo pipefail
config=/etc/nginx/conf.d/weather-payload-compression.conf
backup="/root/weather_backups/payload-compression-$(date +%s)"
mkdir -p "$backup"
if [[ -e "$config" ]]; then cp -a "$config" "$backup/original.conf"; fi
install -m 644 "$(dirname "$0")/weather-payload-compression.conf" "$config"
rollback(){
  if [[ -e "$backup/original.conf" ]]; then cp -a "$backup/original.conf" "$config"; else rm -f "$config"; fi
  nginx -t
  systemctl reload nginx
}
trap 'rollback' ERR
nginx -t
systemctl reload nginx
trap - ERR
printf 'Compression enabled; backup: %s\n' "$backup"
