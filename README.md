# Reg Platform

Internal telecom ops platform for monitoring SIP registrations on an operator softswitch via allowlisted SSH scripts under `/opt/scripts/`.

**Repository:** [github.com/finenumbers/reg](https://github.com/finenumbers/reg) · **Release:** [v1.5.2](https://github.com/finenumbers/reg/releases/tag/v1.5.2)

## Stack (approved)

- Next.js App Router + TypeScript
- PostgreSQL + Prisma
- Better Auth (username login) + RBAC
- shadcn/ui + Tailwind CSS (custom tables + column filters)
- ssh2 + p-queue
- Docker Compose `db` → `migrate` → `app` (external NPM reverse proxy)

## GHCR images (linux/amd64)

| Image | Use |
|-------|-----|
| `ghcr.io/finenumbers/reg:latest` | App (Portainer redeploy) |
| `ghcr.io/finenumbers/reg:latest-migrator` | `prisma migrate deploy` |

Versioned tags (`:1.0.0`, …) are also published by CI; production compose uses **`latest` only**.

## Docs

- [**Portainer + NPM deploy**](docs/deploy-portainer.md) — production stack (`docker-compose.portainer.yml`)
- [architecture](docs/architecture.md)
- [security model](docs/security-model.md)
- [data model](docs/data-model.md)
- [implementation plan](docs/implementation-plan.md)
- [open questions](docs/open-questions.md)
- [current phase](docs/current-phase.md)
- [next steps](docs/next-steps.md)
- [remote softswitch setup](docs/remote-server-setup.md)
- [production checklist](docs/production-checklist.md)
- [backup and restore](docs/backup-and-restore.md)
- [smoke tests](docs/smoke-tests.md)

## Local development

```bash
cp .env.example .env
# edit secrets — set ADMIN_USERNAME / ADMIN_PASSWORD for first admin

docker compose up -d db
npm install
npx prisma migrate dev   # or: npm run db:push (dev only)
npm run db:seed          # RBAC seed + admin bootstrap (also runs on app start)
npm run dev
```

Sign in at `/login` with the bootstrap username/password.

Health:

- `GET /api/healthz` — liveness
- `GET /api/readyz` — env + database readiness

Tests / smoke:

```bash
npm test
npm run smoke                    # requires app listening on BASE_URL
BASE_URL=http://localhost:3000 npm run smoke
```

## Admin bootstrap

Idempotent bootstrap creates the first admin from env when the users table is empty, and ensures the `admin` role if the username already exists:

- `npm run db:seed`
- `npm run bootstrap:admin`
- automatic on Node app startup (`instrumentation.ts`), after platform baseline (RBAC + allowlist)

Public sign-up is disabled. Do not log or commit `ADMIN_PASSWORD`.

## Auth schema

Better Auth Prisma models are **adapter/CLI-generated**:

```bash
npm run auth:generate
```

Do not hand-author conflicting auth table definitions. App RBAC (`roles` / `permissions` / `user_roles`) sits on top of Better Auth user ids.

## Security notes

- Remote execution: allowlisted action codes only → `/opt/scripts/...`
- No arbitrary shell endpoints
- PuTTYgen `.ppk` import is implemented via `ppk-to-openssh` + `sshpk` normalize; passphrase is import-time only and never stored
- Private keys encrypted at rest with AES-256-GCM (`APP_ENCRYPTION_KEY`, 64 hex chars)
- Settings UI/API mask keys (`hasPrivateKey` / fingerprint) — replace only, never export
- SSH connection test is auth/session only; it does **not** run `check_regs.sh`
- `regs.poll` runs only through the jobs allowlist path (`/opt/scripts/check_regs.sh`)
- Auto-poll is Settings-only (`regsPollEnabled` + interval); in-process loop starts at boot; single `app` replica required
- Admin/settings/audit routes require RBAC permissions; anonymous users are redirected or rejected
- Mutating APIs require same-origin Origin/Referer; login/poll/SSH-test are rate-limited (in-memory; single replica)
- Machine API keys (Settings → API-ключи): read-only `regs:read` + `phones:read`; `Authorization: Bearer` / `X-Api-Key`; 10 000 req/min per key; no poll/sync/settings/SSH/RTU-import
- Softswitch host hardening: see [remote-server-setup.md](docs/remote-server-setup.md)

## Settings / SSH APIs

- `GET /api/settings` — masked settings (`settings:write`)
- `PUT /api/settings` — SSH host/port/username + poll/artifact settings
- `PUT /api/settings/ssh/key` — replace private key (`.ppk` / PEM/OpenSSH)
- `POST /api/settings/ssh/test` — connection test (`ssh:test`)
- `GET|POST /api/settings/api-keys` — list / create machine keys (`settings:write`; secret shown once on create)
- `DELETE /api/settings/api-keys/[id]` — revoke key

### Machine read API (API key)

```http
Authorization: Bearer reg_<secret>
```

Allowed with `regs:read` / `phones:read`: `GET /api/regs*`, `GET /api/phones*` (except RTU POST), `GET /api/groups*`, `GET /api/jobs`.

APIs:

- `GET /api/regs` — list current states (`regs:read`); filters: `filters` JSON, `phoneQ`, paging
- `GET /api/regs/[phone]` — current state + change history (`regs:read`)
- `GET /api/regs/facets` — column facet values (`regs:read`)
- `GET /api/regs/export` — XLSX export (`regs:read`)
- `GET /api/regs/status` — last poll + counts for ops widgets (`regs:read`)
- `POST /api/regs/poll` — enqueue manual poll (`regs:poll`)

UI (`/regs`):

- List with phone search, column filters, pagination
- Row click opens a detail sheet (history)
- Manual **Run poll** when the user has `regs:poll` (disabled while in flight)

## Phones

APIs:

- `GET /api/phones` — list endpoints/gateways by `kind` (`phones:read`); filters: `filters` JSON, `phoneQ`, paging
- `GET /api/phones/facets` — column facet values (`phones:read`)
- `GET /api/phones/export` — XLSX export from template (`phones:read`)
- `GET /api/phones/ufw-export` — UFW rules XLSX from DB snapshot (`phones:read`; nothing persisted)
- `GET /api/phones/status` — last sync status (`phones:read`)
- `POST /api/phones/request` — enqueue softswitch sync (`phones:request`)

UI (`/phones`):

- Kind select (gateways / registered / unregistered / error), phone search, column filters
- SIP unregistered highlighting on registered trunks; XLSX export
- **Импорт в РТУ** — выбор XLSX → скачивание CSV; name→ID групп из БД (`routing_groups`, раздел «Входящие группы»)
- **Импорт в UFW** — XLSX с тремя листами правил (шлюзы / транки с рег. / без рег.) из IP-полей снимка БД

## Incoming groups

APIs:

- `GET /api/groups` — routing groups catalog (`phones:read`)
- `GET /api/groups/status` — last `groups.sync` status (`phones:read`)
- `POST /api/groups/request` — enqueue `groups.sync` (`phones:request`)

UI (`/groups`):

- Read-only ID / Name table (sorted by ID ascending)
- **Загрузить данные** runs the same read-only `export.py`, applies only `groups[]`

## Jobs / Audit (Phase 6)

- `GET /api/jobs` — job run history (`regs:read`); `/jobs` UI with status filter + expandable failure detail
- `GET /api/audit` — audit events (`audit:read`); `/audit` UI with action/actor filters + sanitized meta expand
- Home `/` redirects to the first module the user may open (no separate dashboard page)

## Production (Phase 7)

**Preferred:** Portainer + GHCR + external NPM — see [docs/deploy-portainer.md](docs/deploy-portainer.md) and [`docker-compose.portainer.yml`](docker-compose.portainer.yml).

```bash
# Local build (dev/ops host)
cp .env.example .env
# set BETTER_AUTH_SECRET, BETTER_AUTH_URL, APP_ENCRYPTION_KEY (not examples)
docker compose up -d --build
BASE_URL=http://localhost:3000 npm run smoke
```

- Production compose attaches `app` to external NPM network `proxy` (no public `:3000`)
- NPM: forward `/` and `/api` to the same `app:3000` upstream; set `BETTER_AUTH_URL` to the public HTTPS origin
- Auto-poll: enable via Settings `regsPollEnabled` after SSH readiness; keep a single `app` replica
- Backups: `npm run backup:db` — also vault `APP_ENCRYPTION_KEY` ([backup-and-restore.md](docs/backup-and-restore.md))
- Full go-live list: [production-checklist.md](docs/production-checklist.md)

### Must not (production)

- Scale `app` horizontally without leader election
- Enable auto-poll with multiple replicas
- Deploy with placeholder secrets / example encryption key
- Lose `APP_ENCRYPTION_KEY` while expecting to reuse encrypted SSH keys
