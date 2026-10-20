#!/bin/sh
# Schema migrate. A quiet deploy does not read the CDR journal.
# A generation gap is filled by the app job after this container exits.
set -eu

log=$(npx prisma migrate deploy 2>&1)
printf '%s\n' "$log"
printf '%s\n' "$log" | node scripts/cdr-post-migrate.mjs
