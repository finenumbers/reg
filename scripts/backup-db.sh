#!/usr/bin/env bash
# Database backup helper for the compose `db` service.
# Usage:
#   ./scripts/backup-db.sh
#   ./scripts/backup-db.sh /path/to/dir
#
# Restores and encryption-key implications: see docs/backup-and-restore.md

set -euo pipefail

OUT_DIR="${1:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${OUT_DIR}/reg-pg-${STAMP}.sql.gz"

mkdir -p "$OUT_DIR"

POSTGRES_USER="${POSTGRES_USER:-reg}"
POSTGRES_DB="${POSTGRES_DB:-reg}"

echo "Backing up ${POSTGRES_DB} via docker compose service db → ${OUT_FILE}"
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --format=plain \
  | gzip -c > "$OUT_FILE"

echo "Done: ${OUT_FILE}"
echo "Also preserve APP_ENCRYPTION_KEY offline — DB restore alone cannot decrypt SSH keys without it."
