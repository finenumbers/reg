#!/bin/sh
# Schema migrate, then fill derived CDR category/status.
# `npx prisma migrate deploy` alone leaves existing rows blank.
set -eu

npx prisma migrate deploy
node scripts/cdr-call-class-backfill.mjs
node scripts/cdr-tariff-backfill.mjs
