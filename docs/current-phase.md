# Current Phase — production (v1.14.1)

**Status:** in production. Modules beyond Phase 7: phones, groups, CDR/FTP, enrich, geoip/pstn, geography/operators, VoIPmonitor CDR links, month traffic XLSX export.  
**Date:** 2026-08-29

## v1.14.1 — GHCR typecheck

`formatCount` rejects `null`; CDR import summary now passes a number so Docker/GHCR build succeeds.

## v1.14 — month traffic XLSX export

On «Телефонный трафик»: two buttons export the previous full month or the current incomplete month (Settings timezone) as the same two-sheet XLSX as «Обогащение данных». Live `cdr_records`; PSTN/GeoIP gaps filled from cache/API without overwriting stored fields. Progress modal with stages; sheet named after the month.

## v1.13 — operator counts, duration, live loops

Grouped integer counts with U+202F. Softswitch `elapsed_time` is milliseconds: traffic / geography / operators show ceiled seconds after «Переадресация»; VoIPmonitor matcher uses the same conversion. Nav footer shows `v{package.json}`. Isolated live-loop fixes: groups 409 `reason`, empty snapshot vs live table only, FTP save keeps timezone, traffic poll while the tab is visible, enrich resume on 409/412.

## v1.12 — VoIPmonitor links

Isolated matcher in Reg (no Collector runtime). Settings credentials → job `voipmonitor.match` → `cdr_voipmonitor_links` → column **VoIPmonitor** on `/raw` (after `cdr_id`) and `/traffic` (after «Код завершения»). `/jobs` shows unenriched count while backlog remains. Official `fcallid` URL only after confirmed match; archive backfill + retry.

## Goals delivered

1. **Deployment readiness** — Dockerfile multi-stage (`migrator` + `runner`), compose with `db` → `migrate` → `app`, healthchecks, NPM/`proxy` notes, single-replica guidance
2. **Environment validation** — stronger `.env.example`; production rejects placeholder `BETTER_AUTH_SECRET` / example `APP_ENCRYPTION_KEY`; startup validates env; clearer messages
3. **Scheduler safety** — in-process loop always-on; enablement is Settings `regsPollEnabled` only; docs forbid multi-replica polling
4. **Backup / restore** — `docs/backup-and-restore.md` + `scripts/backup-db.sh` (`npm run backup:db`)
5. **Smoke / acceptance** — `docs/smoke-tests.md` + `scripts/smoke-check.sh` (`npm run smoke`)
6. **Hardening polish** — security headers; Better Auth `trustedOrigins` + secure cookies on HTTPS; readiness omits internal details in production; platform baseline ensured on startup
7. **Go-live checklist** — `docs/production-checklist.md`

## Operator surfaces added/updated

| Item | Purpose |
|------|---------|
| `migrate` compose service | `prisma migrate deploy` before `app` |
| Baseline migration `prisma/migrations/20260806100000_init` | Production schema apply path |
| `/api/healthz` / `/api/readyz` | Liveness; env+DB readiness |
| Startup instrumentation | Env assert → baseline seed → admin bootstrap → scheduler eval |
| `docs/production-checklist.md` | Full go-live list + must-not-do |
| `docs/backup-and-restore.md` | `pg_dump` / restore / encryption key |
| `docs/smoke-tests.md` | Automated + UI acceptance |

## Explicitly NOT done in Phase 7

- Leader election / multi-replica safe scheduling
- Enabling auto-poll by default in Settings (`regsPollEnabled` stays false until operator opts in)
- Automated backup daemons / offsite sync products
- Full CSP redesign or WAF
- New business modules or UI redesigns

## Backend architecture unchanged

Allowlist poll path, anti-overlap, SSH key masking, CSRF/rate limits, and Phase 4–6 APIs/UI contracts are unchanged. Phase 7 is ops/deploy polish only.
