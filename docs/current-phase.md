# Current Phase — production (v1.50.0)

**Status:** in production. Modules beyond Phase 7: phones, groups, CDR/FTP, enrich, geoip/pstn, geography/operators, VoIPmonitor CDR links, month traffic XLSX export, CDR month switcher, CDR month storage/purge, CDR statistics, client traffic detail.  
**Date:** 2026-09-14

## v1.50.0 — CDR month storage lives on Settings

«Хранение данных» is a section at the bottom of `/settings` (after API keys): month table, totals, oldest-complete-month delete. The admin nav item and `/storage` page are gone; `/storage` still requires `settings:write` and redirects to `/settings#cdr-storage`. The snapshot loads on the client (`GET /api/storage`) so Settings SSH/keys do not wait on the full-table month `GROUP BY`. `POST /api/storage/purge`, `cdr.purge.month`, and civil-clock CDR cells / XLSX are unchanged.

## v1.49.0 — Live clocks in the left nav footer

UTC and local time sit in the left navigation footer (above the version and «Выйти») on every admin page, as two `text-sm` stacks: «Время UTC» / «Местное время». They are gone from CDR table headers. Local time still follows the Settings display timezone. Civil-clock CDR cells / XLSX are unchanged.

## v1.48.1 — CDR header clocks on one 14px line

CDR tables (traffic / operators / geography / raw) show UTC and local time as one `text-sm` line next to the title: «Время UTC: HH:mm:ss    Местное время: HH:mm:ss». The two-line 12px stack and header `pt-1.5` are gone. Tick, Settings timezone, and civil-clock CDR cells / XLSX are unchanged.

## v1.48.0 — Live UTC and local clocks on CDR table headers

CDR tables (traffic / operators / geography / raw) show two live `HH:mm:ss` lines next to the title: «Время UTC» and «Местное время». Local time uses the Settings display timezone; both lines share one workstation `Date.now()` snapshot. Detail, table cells, and XLSX stay civil-clock from the CDR file.

## v1.47.3 — Badge chrome on row-color checkboxes

Toolbar labels «Фантомный трафик», «Ошибки звонков», «Паркинг», and «Недозвон» on CDR tables (traffic / geography / operators / raw) use the same pill chrome as the Registrations «Статус» badge (`h-5`, `rounded-4xl`, `px-2`), with 14px text. «Без регистрации» on «Регистрации» and «Телефонные номера» → «Транки с регистрацией» matches. Row fills stay the same pastel tones. Filters, row paint, and XLSX are unchanged.

## v1.47.2 — Traffic status uses the month-count cache

`GET /api/traffic/status` still returns `recordCount`. The extra full-table `COUNT(*)` on every 4s poll is gone; the number is the sum of the existing 60s month-count cache (`cdr_day`). Import and purge already invalidate that cache. Filters, row paint, and XLSX are unchanged.

## v1.47.1 — Color plates on row-color checkboxes

Toolbar labels «Фантомный трафик», «Ошибки звонков», «Паркинг», and «Недозвон» on CDR tables (traffic / geography / operators / raw) use a solid `rounded-sm` plate in the same base fill as the matching row. «Без регистрации» on «Регистрации» and «Телефонные номера» → «Транки с регистрацией» uses the unregistered row tint. The v1.47.0 highlighter stroke is gone. Filters, row paint, and XLSX are unchanged.

## v1.47.0 — Marker legend on row-color checkboxes

Toolbar labels «Фантомный трафик», «Ошибки звонков», «Паркинг», and «Недозвон» on CDR tables (traffic / geography / operators / raw) get a highlighter stroke in the same base fill as the matching row. «Без регистрации» on «Регистрации» and «Телефонные номера» → «Транки с регистрацией» uses the unregistered row tint. Filters, row paint, and XLSX are unchanged.

## v1.46.1 — Канальность is the raw catalog capacity

«Канальность» copies `phone_endpoints.data["ИНИЦ. емкость"]` as stored in «Телефонные номера». An empty / whitespace-only field and a registration with no catalog row are both empty («—», empty facet / XLSX cell). The synthetic fallback is gone.

## v1.46.0 — Канальность on Registrations

«Регистрации» adds «Канальность» between «Телефон» and «Описание». Values come from `phone_endpoints.data["ИНИЦ. емкость"]` when the SIP number matches. Column filters, mutual facets, detail sheet, and the full-table XLSX export include the column. Toolbar phone search is unchanged.

## v1.45.0 — Gray «Недозвон» rows and checkbox

CDR tables (traffic / geography / operators / raw) paint a row gray when side A or B is a known catalog description, «Длительность» is empty (`elapsed_time === ""`), and the row is not phantom / parking / call-error. Toolbar checkbox «Недозвон» keeps that class (OR with the other three). Month XLSX uses the same fill (`#E5E7EB`); `seconds === 0` alone is not empty. The hint under traffic export buttons is gone.

## v1.44.0 — Month XLSX fill note and OOXML regression

«Сохранить данные» still writes the whole selected month. Row fills stay the three table classes (phantom / parking / call-error); blue «Нет в биллинге» text is independent. A short hint under the traffic export buttons states that. Tests now assert solid `applyFill` xfs in `styles.xml`, not only the ExcelJS cell getter. Writer unchanged.

## v1.43.0 — Green phantom traffic rows

CDR tables (traffic / geography / operators / raw) paint phantom rows green (`bg-green-200`) instead of gray. Month and enrich XLSX use the same fill (`#BBF7D0`). Classification is unchanged: both billing numbers filled, both sides «Нет в биллинге». Parking stays blue; call-error stays light red.

## v1.42.0 — Parking checkbox on CDR tables

CDR toolbar (traffic / geography / operators / raw) adds «Паркинг» next to «Фантомный трафик» and «Ошибки звонков». It keeps rows classified as parking-known: «Объект набора» is `Service_Parking` and side A or B is a known description. Combines with the other two flags by OR; reset and column facets keep the flag.

## v1.41.0 — Blue parking rows with a known side

CDR tables (traffic / geography / operators / raw) paint a row blue when «Объект набора» is exactly `Service_Parking` and side A or side B is a known catalog description. Phantom stays gray (both sides «Нет в биллинге»); call-error stays light red. Month and enrich XLSX use the same blue fill (`#BFDBFE`). No new toolbar filter.

## v1.40.0 — Unregistered rows on Registrations

«Регистрации» paints `Unregistered` rows with the same light red as «Транки с регистрацией» (`bg-destructive/10`; selected stays `bg-destructive/20`). The «Не зарегистрирован» badge is saturated red (`bg-red-600`), pairing the green Registered badge. XLSX uses the same `#FEE2E2` row fill as phones. Filters, poll, and API are unchanged.

## v1.39.0 — Unregistered checkbox on Registrations

«Регистрации» gets the same toolbar checkbox «Без регистрации» as «Телефонные номера»: one click keeps `reg_current` rows with status Unregistered. List and facets share `unregisteredOnly` (AND with phone search and column filters). Reset, infinite scroll, and poll keep the flag. XLSX export stays a full snapshot.

## v1.38.1 — Drop the detail page footnote

`/detail` no longer shows the operator explainer under the table (client = Описание, independent slices, parking ⊂ incoming, totals ≠ unique CDRs).

## v1.38.0 — Client traffic detail after raw CDR

«Детализация» (`/detail`, `phones:read`) sits in CDR nav after «Сырые данные». One row per current catalog **Описание** (all its endpoint numbers). Month switcher; independent slices: incoming (B-number), outgoing `PSTN_*_Local`, incoming parking (`Service_Parking` on B), external `Trunk_*`, long-distance `PSTN_*_LDC` / `_OLD`. Same call can be outgoing for A and incoming for B. Minutes are per-call `CEIL(CEIL(ms/1000)/60)`. Sort the full table (client A–Z, or a group by minutes desc); infinite scroll 100; sticky header; «Итого» from the whole snapshot; zeros are «-». Client column is at least 250px and sized to the longest name. SQL joins trimmed catalog numbers to `bill_ani` / `bill_dnis` (not `side_*`). No new tables or indexes.

## v1.37.3 — Stats totals bold; platforms table matches SIP chrome

All «Итого» cells on `/stats` are bold. **Технологические платформы** uses the same two-level header and column widths as the SIP tables: **Входящий трафик** / **Исходящий трафик** × Звонки/Минуты (name 210px, metrics 90px). Minutes stay bold; «Итого» minute cells stay yellow.

## v1.37.2 — Fixed SIP stats column widths

«Присоединение» / «SIP-транк» are 210px; every «Звонки» and «Минуты» column is 90px (`table-fixed` + colgroup). Platforms table is unchanged.

## v1.37.1 — Jobs expanded message

Successful job rows no longer expand to empty «Сообщение» / «Код выхода». The panel writes a short operator sentence from counters and `meta`. Zero `cdr.sides.refresh` reads as «Без изменений»; enrich stats are Russian (кэш / запросы).

## v1.37.0 — Readable Jobs results

«Задачи» shows human action names and operator-facing result lines. `GET /api/jobs` returns sanitized `meta`; the summary uses per-action counter meaning (import skipped rows are «уже в базе», VoIPmonitor skip/empty-queue are not a silent success). Expanded row lists whitelisted details, not raw JSON.

## v1.36.0 — VoIPmonitor match findFirst flake; Jobs status filter

`voipmonitor.match` no longer dies on the Prisma `cdrRecord.findFirst` existence-check (same predicate is raw SQL + a short transient retry). Jobs list probes cannot 500 `GET /api/jobs`; `errorMessage` is truncated on read; the status filter uses one request and a successful poll clears the red banner.

## v1.35.0 — Grouped SIP stats; minutes highlight; table chrome

«Внешняя нумерация» uses the same two-level header as ТфОП (Входящий/Исходящий трафик, Входящий паркинг, Фантомный трафик × Звонки/Минуты) **without Межгород**. Minutes on both SIP tables are bold; «Итого» minute cells are bright yellow. Data tables (stats, storage, API keys) have no `rounded-md border` card — same chrome as CDR traffic.

## v1.34.0 — Join Local/LDC PSTN rows on ТфОП stats

«Присоединения к ТфОП» uses a two-level header (Присоединение + grouped Звонки/Минуты). One row per logical `PSTN_*` name with `_Local`/`_LDC` stripped. Incoming / outgoing / incoming parking / phantom come from `*_Local` or unsuffixed `PSTN_*`. **Межгород** is outgoing calls/minutes of the paired `PSTN_*_LDC` only. The separate LDC table is gone. `GET /api/stats` drops `pstnLdc` and adds `ldcCalls`/`ldcMinutes` on `pstnTfop` rows. Parking formula is unchanged (`src` SIP trunk → `Service_Parking`).

## v1.33.0 — Incoming parking and phantom columns on SIP stats

«Статистика» table order: ТфОП, внешняя нумерация, LDC, platforms. ТфОП and внешняя нумерация add **Входящий паркинг** / **Минуты паркинга** / **Фантомный трафик** / **Минуты фантома**. Parking = initiating SIP trunk (`PSTN_` / `Trunk_`) and terminating `Service_Parking`. Phantom = parking plus both stored sides «Нет в биллинге» (not the `/traffic` phantom filter). Empty cells stay «-».

## v1.32.0 — Split SIP stats tables; dash for empty counts

«Статистика» splits SIP trunks into **Присоединения к ТфОП** (`PSTN_*` except `_LDC`, including `_Local` and unsuffixed), **Междугородняя и международная связь** (`PSTN_*_LDC`), and **Внешняя нумерация** (`Trunk_*`). Empty call/minute cells (including totals) show «-», not `0`. Platforms table is unchanged.

## v1.31.0 — CDR statistics; storage seconds and billable minutes

«Статистика» (`/stats`, `phones:read`) sits in admin nav between Настройки and Хранение данных. Month switcher plus two summaries: SIP trunks (`PSTN_` / `Trunk_`) and platforms (`Service_` / `Platform_`). Initiating device → inbound, terminating → outbound; a call that matches several categories is counted in each. Minutes are `CEIL(CEIL(ms/1000)/60)` per call (same as XLSX). `/storage` adds **Кол-во секунд** (`SUM` of per-call `CEIL(ms/1000)`) and uses the same per-call minutes — not total seconds / 60.

## v1.30.0 — CDR month storage

Admin «Хранение данных» (`/storage`, `settings:write`) lists stored CDR months (calls + minutes) and deletes only the oldest complete UTC month, one at a time (`cdr.purge.month`). Current month is never deletable. Batched `DELETE` on `cdr_date LIKE`; month dropdown counts come from a 60s cache of `GROUP BY left(cdr_day, 7)`. Import rejects rows without civil date/time; poison/hold files are listed on «Сырые данные». Purge will not start while `cdr.import` is in flight; rows of the purge target month are held in the inbox (not unlinked) until the job finishes.

## v1.29.1 — GHCR typecheck

Job runtime reads `replay` only after narrowing the processor union so `next build` on GHCR succeeds.

## v1.29.0 — CDR side labels follow the phones catalog

«Сторона А/В» in traffic still search the whole selected month on stored `side_*`. When a phone’s Описание appears or changes, job `cdr.sides.refresh` writes the new label onto matching `bill_ani` / `bill_dnis` (all months). Settings toggle + interval; first run ~15s after deploy if no snapshot yet; always runs after a successful `phones.sync` or `cdr.import`. Empty catalog does not wipe sides. Facets and filters stay unchanged.

## v1.28.0 — Time sort in Date context; fewer facet reloads

Time sort is server `ORDER BY cdr_date, cdr_id` (full UTC chronology for the month, not clock-across-days). The first Time click (desc) matches the default list and does not refetch. Header facet menus (traffic / phones / regs) do not reload when only the open column’s chips change or the parent re-renders.

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

On «Задачи» exhausted VoIPmonitor misses (sentinel `next_attempt_at`) leave the yellow banner. Open leftovers stay `total − with URL − parked`; the due queue is a raw `SELECT 1` (v1.36.0). Parked count is a muted hint on the status filter row (`Не найдены в VoIPmonitor: N`).

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

## v1.14 — month traffic XLSX export _(superseded by v1.21.0 / v1.22.0)_

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

| Item                                                       | Purpose                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| `migrate` compose service                                  | `prisma migrate deploy` before `app`                          |
| Baseline migration `prisma/migrations/20260806100000_init` | Production schema apply path                                  |
| `/api/healthz` / `/api/readyz`                             | Liveness; env+DB readiness                                    |
| Startup instrumentation                                    | Env assert → baseline seed → admin bootstrap → scheduler eval |
| `docs/production-checklist.md`                             | Full go-live list + must-not-do                               |
| `docs/backup-and-restore.md`                               | `pg_dump` / restore / encryption key                          |
| `docs/smoke-tests.md`                                      | Automated + UI acceptance                                     |

## Explicitly NOT done in Phase 7

- Leader election / multi-replica safe scheduling
- Enabling auto-poll by default in Settings (`regsPollEnabled` stays false until operator opts in)
- Automated backup daemons / offsite sync products
- Full CSP redesign or WAF
- New business modules or UI redesigns

## Backend architecture unchanged

Allowlist poll path, anti-overlap, SSH key masking, CSRF/rate limits, and Phase 4–6 APIs/UI contracts are unchanged. Phase 7 is ops/deploy polish only.
