#!/bin/sh
# App container entrypoint — starts Next.js standalone server.
# Schema migrations run via the compose `migrate` service (Dockerfile target: migrator),
# or manually: ./scripts/db-migrate.sh / npx prisma migrate deploy
set -eu

echo "[entrypoint] Starting app (HOSTNAME=${HOSTNAME:-0.0.0.0} PORT=${PORT:-3000})..."
echo "[entrypoint] Auto-poll is Settings-gated (regsPollEnabled); keep a single app replica"
exec node server.js
