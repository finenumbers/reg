#!/usr/bin/env bash
# One-shot migrate deploy against compose `db` (when not using image entrypoint).
# Usage (from repo root, with stack network up):
#   ./scripts/db-migrate.sh
set -euo pipefail

echo "Running prisma migrate deploy (host tooling → DATABASE_URL)..."
if [[ -z "${DATABASE_URL:-}" ]]; then
  export DATABASE_URL="${DATABASE_URL:-postgresql://reg:reg@localhost:5432/reg?schema=public}"
  echo "Using DATABASE_URL=$DATABASE_URL"
fi
log=$(npx prisma migrate deploy 2>&1)
printf '%s\n' "$log"
echo "Migrations applied."
printf '%s\n' "$log" | node scripts/cdr-post-migrate.mjs
echo "CDR post-migrate finished."
