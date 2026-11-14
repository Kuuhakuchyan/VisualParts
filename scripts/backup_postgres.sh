#!/usr/bin/env sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-/root/weather_backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
CONTAINER="${POSTGRES_CONTAINER:-postgres_iot}"
DATABASE="${POSTGRES_DB:-iot_platform}"
PG_BACKUP_USER="${POSTGRES_USER:-iot_user}"
STAMP="$(date +%Y%m%d-%H%M%S)"

case "$DATABASE" in ''|*[!A-Za-z0-9_]*) echo "invalid database name" >&2; exit 2;; esac
case "$RETENTION_DAYS" in ''|*[!0-9]*) echo "invalid retention days" >&2; exit 2;; esac
umask 077
mkdir -p "$BACKUP_DIR"
STAGED="$(mktemp "$BACKUP_DIR/.${DATABASE}-XXXXXX")"
trap 'rm -f "$STAGED"' EXIT HUP INT TERM

docker exec "$CONTAINER" pg_dump -U "$PG_BACKUP_USER" --format=custom "$DATABASE" > "$STAGED"
test -s "$STAGED"
docker exec -i "$CONTAINER" pg_restore --list < "$STAGED" > /dev/null
FINAL="$BACKUP_DIR/${DATABASE}-${STAMP}-$$.dump"
mv "$STAGED" "$FINAL"
find "$BACKUP_DIR" -type f -name "${DATABASE}-*.dump" -mtime +"$RETENTION_DAYS" -delete

echo "backup written: $FINAL"
