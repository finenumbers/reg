# Current Phase — production (v1.27.1)

**Status:** in production. Modules beyond Phase 7: phones, groups, CDR/FTP, enrich, geoip/pstn, geography/operators, VoIPmonitor CDR links, month traffic XLSX export, CDR month switcher.  
**Date:** 2026-08-30

## v1.27.1 — GHCR typecheck

ExcelJS `Row.values` is a union; the Date/Time header assertion now reads cells via `getCell` so `next build` on GHCR succeeds.

## v1.27.0 — Time sort and Date facet order

Time on traffic / geography / operators sorts by clock (`cdr_time`, then `cdr_date`, `cdr_id`) with up/down only — no facet menu. Date facet chips stay in increasing calendar order. Enrich and month XLSX write **Дата** / **Время** instead of «Время звонка»; billing-miss labels are blue in the table and XLSX. `/raw` still has a single `cdr_date`.

## v1.26.0 — CDR date and time columns

Traffic / geography / operators replace «Время звонка» with **Дата** (`30.08.2026`) and **Время** (`14:22:52`). Import writes `cdr_day` / `cdr_time` from `cdr_date` (same slice as the SQL backfill). Mutual column facets stay AND/OR/`excludeColumn`. Phantom rows are darker gray; call-error rows are a stronger red. `/raw` and month XLSX keep a single `cdr_date`.

## v1.25.0 — phantom traffic and empty billing numbers

CDR tables (traffic / geography / operators / raw) color phantom rows gray (both billing numbers filled, both sides «Нет в биллинге») and call-error rows red (both `bill_ani` / `bill_dnis` exactly `""`). Toolbar checkboxes filter those classes together with month, phone search, and column facets. Header-menu search for «пусто» finds the empty-string group. Month and enrich XLSX fill the same rows.

## v1.24.0 — case-insensitive traffic search

Header-menu facet search and the toolbar phone search on traffic / geography / operators / raw use Prisma `contains` with `mode: "insensitive"`. Phones and registrations facet search already compared via `toLowerCase()`.

## v1.23.0 — CDR month switch clears column filters; facet search matches the table

Changing the traffic / geography / operators / raw month `<select>` clears column facet chips (phone search stays). Header-menu search for `cdr_date` and duration accepts the on-screen text (`28.12.2026`, `10` seconds), not only the raw stored string.

## v1.22.0 — parked VoIPmonitor hint and two traffic saves

On «Задачи» exhausted VoIPmonitor misses (sentinel `next_attempt_at`) leave the yellow banner. Open leftovers stay `total − with URL − parked`; the due queue is still `findFirst`. Parked count is a muted hint on the status filter row (`Не найдены в VoIPmonitor: N`).

On «Телефонный трафик» «Сохранить данные» writes one month sheet; «Сохранить расширенные данные» keeps month + «Детализация». Enrich «Обогащение данных» still writes two sheets. Repeat `cdrAt` sync skips already-aligned rows.

## v1.21.0 — save traffic XLSX for the selected month

On «Телефонный трафик» one button «Сохранить данные» exported the two-sheet enrich XLSX for the UTC calendar month currently selected in the dropdown. The first sheet is named after that month (no «неполный» suffix). v1.22.0 split that into basic (one sheet) and extended (two sheets).

## v1.20.0 — CDR calendar month switcher

Traffic, operators, geography and raw share a month `<select>` on the phone-search row (right-aligned, «Август 2026 года»). Default / refresh / reset is the current UTC calendar month of `cdr_date`. Phone search and column facets AND with that month; the option list is a cheap MIN/MAX calendar, not DISTINCT on every keystroke.

## v1.19.2 — CDR UI after VoIPmonitor queue filter

Exhausted «not found» rows park on a far-future `next_attempt_at` instead of a `LIKE` on `evidence_json`. Matcher and Jobs stop scanning `cdr_records` on every tick, so traffic / geography / operators / raw stay responsive. v1.22.0 hides parked leftovers from the yellow banner (`total − with URL − parked`) and shows them as a quiet filter-row hint.

## v1.19.1 — GHCR typecheck

Jobs poll timer is a DOM `number`, matching «Телефонный трафик», so `next build` on GHCR succeeds.

## v1.19.0 — share exact VoIPmonitor links

Exact Call-ID match writes a Calltrace URL even if another Satel row already claimed that VM call. «Not found» misses stop after 12 attempts so `/jobs` does not spin; the Jobs list and enrich banner refresh while the tab is visible.

## v1.18.0 — separate phones/groups schedule

Registrations keep `regsPollEnabled` / `regsPollIntervalSec`. Phones and incoming groups use `exportSyncEnabled` / `exportSyncIntervalSec` (one `export.py` at a time, alternating). The two loops do not share a tick. Default export interval is 300s and off until enabled.

## v1.17.0 — scheduled phones/groups and Jobs enrich banner

Settings «Регулярная загрузка» now also schedules `phones.sync` and `groups.sync` on the same interval (one `export.py` at a time, alternating). `/jobs` shows PSTN/GeoIP backlog next to VoIPmonitor. Traffic inbox banner waits for two or more pending files so a single in-flight import stays quiet.

## v1.16.1 — match visibility and PSTN retry

Successful VoIPmonitor matches always write at least `legs.in` (conf-only / unclassified fallback no longer leave Calltrace empty). VM rows without `cdrId` are reserved by `callId|callDate` so two CDRs cannot share one call. PSTN live API errors no longer fake a not-found hit, so `enrichedAt` stays null and backfill retries.

## v1.16.0 — VoIPmonitor in/out legs

Matcher stores both Satel signaling legs (in/out Call-ID) as official `fcallid` links. `/raw` shows **VoIPmonitor In/Out** after `cdr_id`; «Телефонный трафик» shows **Calltrace In/Out** after «Код завершения». Migration adds `voipmonitor_legs` and deletes existing links so `voipmonitor.match` re-enriches the archive.

## v1.15.0 — VoIPmonitor match throughput

Hour fetch runs 10 parallel `getVoipCalls` slices; archive first pass skips Call-ID probes; fallback no longer verifies via extra API; links are written in one SQL upsert per chunk. One live hour, then archive hours until the 2-minute job budget. Job meta records fetch/probe/match timings.

## v1.14.2 — traffic export directory

Create `/app/data/traffic-export` in the image (owned by `nextjs`) and mount `reg_traffic_export`. Fixes EACCES on month XLSX export.

## v1.14.1 — GHCR typecheck

`formatCount` rejects `null`; CDR import summary now passes a number so Docker/GHCR build succeeds.

## v1.14 — month traffic XLSX export *(superseded by v1.21.0 / v1.22.0)*

Historical: two buttons exported the previous full month or the current incomplete month (Settings timezone). v1.21.0 replaced that with one «Сохранить данные» button for the UTC calendar month selected in the dropdown (no «неполный» suffix). v1.22.0 split basic vs extended sheets. Live `cdr_records`; PSTN/GeoIP gaps filled from cache/API without overwriting stored fields. Progress modal with stages; sheet named after the month.

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
