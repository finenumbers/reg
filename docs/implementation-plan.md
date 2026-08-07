# Implementation Plan

Поэтапный план реализации после закрытия open questions.  
**Сейчас:** Phase 7 (production readiness) complete — см. [current-phase.md](./current-phase.md) и [next-steps.md](./next-steps.md).

## 0. Preconditions

Open questions **закрыты** — см. [open-questions.md](./open-questions.md).

Утверждено для реализации:

- sudo на softswitch разрешён узко (NOPASSWD); app шлёт константу `sudo -n -- /opt/scripts/check_regs.sh` из allowlist;
- local auth only через Better Auth;
- один SSH profile;
- retention артефактов и interval опроса — поля в Settings UI;
- при ошибке poll — не писать regs, показать проблему в UI;
- сразу `platform_exec.sh`;
- bootstrap admin из env;
- внешний NPM, сеть `proxy`;
- ключ только replace, без export;
- стек: Next.js App Router + Prisma + PostgreSQL + Better Auth + ssh2 + p-queue + shadcn/ui (Q11).

## 1. Target stack (напоминание)

- Одно приложение Next.js (App Router): UI + Route Handlers
- PostgreSQL 16 + Prisma
- Better Auth (username + password sessions; Prisma schema from official adapter/CLI) + RBAC поверх
- UI: shadcn/ui + Tailwind CSS; tables: custom tables + column filters
- Job orchestration: `p-queue` in-process (одна реплика `app` в v1); bootstrap eval via `instrumentation.ts` (реальный poll позже)
- SSH: `ssh2`, AES-GCM secrets, PPK import
- Внешний NPM; compose без edge proxy и без Redis/BullMQ

## 2. Phases

### Phase 1 — Scaffold + docs

**Сделать:**

- структура `src/` (app routes, modules, lib), `prisma/`
- `docker-compose.yml`: `app`, `db` (+ сеть `proxy`)
- `Dockerfile`, `.env.example`
- Prisma schema (сущности из data-model, включая Better Auth tables)
- health endpoints skeleton
- module skeletons (auth, settings, ssh, actions, jobs, registrations, audit, health)
- secure execution abstraction (allowlist only — без реального SSH exec бизнес-логики)
- README с ссылками на docs + `docs/current-phase.md` / `docs/next-steps.md`

**Checkpoint:** `compose up` поднимает db; Prisma migrate/generate ok; `next build` близок к успешному; health отвечает.

### Phase 2 — Auth + admin shell

**Сделать:**

- Better Auth wiring (login/logout/session)
- users/roles seed, bootstrap admin from env
- permission guards (server + route)
- login page, app shell, nav stubs, auth gate

**Checkpoint:** admin логинится, operator role отличима permission’ами.

### Phase 3 — Settings + SSH/PPK (platform-core)

**Сделать:**

- ssh profile CRUD (без отдачи plaintext key)
- PPK/PEM import + normalize + encrypt (AES-GCM)
- test-connection через allowlisted action
- audit events
- Settings UI: host/port/user/key upload/passphrase/poll toggles
- masked key state (`has_key`, fingerprint)
- test result panel

**Checkpoint:** `.ppk` с passphrase импортируется; test возвращает предсказуемые ошибки/успех; ключ не видно в API.

### Phase 4 — Registrations backend (first module)

**Сделать:**

- seed `allowed_actions.regs.poll` → `/opt/scripts/check_regs.sh`
- parser + unit tests на примере CSV
- `p-queue` processor `regs.poll` (schedule + manual)
- anti-overlap (concurrency 1 + in-flight guard)
- apply to `reg_current` / `reg_change_events`
- API list/search/history/status/poll

**Checkpoint:** при mock/real SSH данные пишутся; unchanged poll не плодит history; empty/fail не портит current.

### Phase 5 — Registrations UI

**Сделать:**

- dashboard counters + last poll status
- table (custom + column filters): search, status filter, sort
- detail sheet with history timeline
- manual poll button

**Checkpoint:** операторский сценарий end-to-end через UI и локальную БД.

### Phase 6 — Audit / jobs UI / hardening

- Jobs page
- Audit page (admin)
- login rate limit, CSRF/origin checks (совместимо с Better Auth cookies)
- log redaction review
- remote server setup runbook (forced command, sudoers/ACL) как `docs/remote-server-setup.md`

**Checkpoint:** security checklist выполнен. **Status: complete.**

### Phase 7 — Production readiness

- Portainer stack / compose (`db` → `migrate` → single `app`)
- NPM routing notes (`/` и `/api` → один сервис `app`)
- backup `pg_dump` notes + helper script
- prod env checklist + startup validation (reject weak production secrets)
- smoke test script + operator checklist
- явное напоминание: v1 = одна реплика `app` из‑за in-process scheduler
- **Status: complete.** See [production-checklist.md](./production-checklist.md).

## 3. API routes (v1)

### Auth (Better Auth)
- `/api/auth/*` — handler Better Auth (sign-in, sign-out, session, …)
- `GET /api/auth/me` — опциональный thin wrapper над session + roles/permissions

### Settings / SSH
- `GET /api/settings`
- `PUT /api/settings`
- `PUT /api/settings/ssh/key` (multipart/raw replace)
- `POST /api/settings/ssh/test`

### Registrations
- `GET /api/regs?filters&phoneQ&page&pageSize`
- `GET /api/regs/[phone]` (current + history)
- `GET /api/regs/facets`
- `GET /api/regs/export`
- `POST /api/regs/poll`
- `GET /api/regs/status` (summary)

### Phones
- `GET /api/phones?kind&filters&phoneQ&page&pageSize`
- `GET /api/phones/facets`
- `GET /api/phones/export`
- `GET /api/phones/status`
- `POST /api/phones/request`

### Jobs / Audit
- `GET /api/jobs`
- `GET /api/jobs/:id`
- `GET /api/audit`

### Health
- `GET /api/healthz`
- `GET /api/readyz` (db)

## 4. Backend module map

| Module (`src/modules/*`) | Boundary |
|--------------------------|----------|
| `auth` | Better Auth config, session helpers |
| `users` | user admin, bootstrap |
| `rbac` | roles/permissions checks |
| `settings` | app settings |
| `ssh` | crypto, ppk import, client, test |
| `actions` | allowlist resolve/validate/execute interface |
| `jobs` | p-queue wiring, job_runs persistence |
| `registrations` | parser, apply, queries |
| `audit` | append/list |
| `health` | probes |

UI pages и Route Handlers вызывают модули; бизнес-логика не живёт в «тонких» page-файлах.

## 5. Frontend pages

| Route | Purpose |
|-------|---------|
| `/login` | вход |
| `/` | redirect на первый доступный модуль |
| `/regs` | таблица + detail sheet (история) |
| `/phones` | таблица endpoints/gateways |
| `/settings` | SSH + poll |
| `/jobs` | execution history |
| `/audit` | admin audit |

## 6. Polling design

- Source of truth schedule: `app_settings`
- On boot + on settings save: reschedule in-process interval / timer
- `regs.poll` serialized через `p-queue` (concurrency 1) + in-flight guard
- Manual poll ставит ту же задачу в очередь
- No aggressive retries on schedule failures (не молотить softswitch)
- Persist every attempt in `job_runs`
- v1 assumption: single `app` replica

## 7. Parser / failure behaviors

| Case | Behavior |
|------|----------|
| Empty stdout | fail run; keep current |
| Malformed line | skip + bad counter |
| Duplicate phone in one output | last wins + warning |
| Identical state | update `last_seen_at` only |
| SSH timeout/auth error | fail run; scheduler continues |
| exitCode ≠ 0 / fail | fail run; **не применять** данные; UI показывает ошибку последнего цикла |

## 8. Order of implementation chats

1. Scaffold Next.js + Prisma + compose + module boundaries  
2. Auth (Better Auth) + shell  
3. SSH/PPK/settings  
4. Regs backend jobs (`p-queue`)  
5. Regs UI (custom tables + sheet)  
6. Hardening + remote runbook  
7. Prod deploy notes  

## 9. Explicit non-goals for v1

- Kubernetes
- Public multi-tenant API
- In-app reverse proxy instead of NPM
- Editable remote command in UI
- SSO / LDAP
- Несколько softswitch / несколько SSH profiles
- Просмотр или скачивание сохранённого SSH-ключа из UI
- NestJS / отдельный React-Vite frontend / Redis+BullMQ
- Горизонтальное масштабирование нескольких `app`-реплик без leader election
