#!/bin/sh
# App container entrypoint — starts Next.js standalone server.
# Schema migrations run via the compose `migrate` service (Dockerfile target: migrator),
# or manually: ./scripts/db-migrate.sh (migrate + CDR category backfill)
set -eu

echo "[entrypoint] Starting app (HOSTNAME=${HOSTNAME:-0.0.0.0} PORT=${PORT:-3000})..."
if [ "${1:-}" = "smg-syslog" ]; then
  echo "[entrypoint] Starting SMG syslog receiver"
  exec node smg-syslog-receiver.cjs
fi
echo "[entrypoint] Auto-poll is Settings-gated (regsPollEnabled); keep a single app replica"
exec node server.js
