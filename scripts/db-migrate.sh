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
npx prisma migrate deploy
echo "Migrations applied."
