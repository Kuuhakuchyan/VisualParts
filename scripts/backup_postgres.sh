#!/usr/bin/env sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-/root/weather_backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
CONTAINER="${POSTGRES_CONTAINER:-postgres_iot}"
DATABASE="${POSTGRES_DB:-iot_platform}"
USER="${POSTGRES_USER:-iot_user}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"

docker exec "$CONTAINER" pg_dump -U "$USER" "$DATABASE" | gzip -9 > "$BACKUP_DIR/${DATABASE}-${STAMP}.sql.gz"
find "$BACKUP_DIR" -type f -name "${DATABASE}-*.sql.gz" -mtime +"$RETENTION_DAYS" -delete

echo "backup written: $BACKUP_DIR/${DATABASE}-${STAMP}.sql.gz"
