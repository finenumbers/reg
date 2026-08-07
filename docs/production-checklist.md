# Production go-live checklist

Operator checklist for deploying Reg behind Docker/Portainer + Nginx Proxy Manager.  
**Recommended production path:** GHCR images + [`docker-compose.portainer.yml`](../docker-compose.portainer.yml) — see [deploy-portainer.md](./deploy-portainer.md).  
Related: [backup-and-restore.md](./backup-and-restore.md), [smoke-tests.md](./smoke-tests.md), [remote-server-setup.md](./remote-server-setup.md), [security-model.md](./security-model.md).

## Must not do (production)

- Do **not** run more than **one** `app` replica (no leader election; in-memory rate limits; in-process scheduler).
- Do **not** enable Settings `regsPollEnabled` until SSH + softswitch wrapper/sudoers are verified and you intentionally want auto-poll.
- Do **not** use example/placeholder `BETTER_AUTH_SECRET` or `APP_ENCRYPTION_KEY` (production startup rejects them).
- Do **not** lose `APP_ENCRYPTION_KEY` — stored SSH private keys become undecryptable.
- Do **not** expose PostgreSQL publicly if avoidable; prefer `docker compose exec` / Portainer for dumps.
- Do **not** put arbitrary remote commands in Settings — allowlist only.
- Do **not** treat SSH connection test as a registration poll.

## 1. Secrets and env

Copy `.env.example` → `.env` (or Portainer stack env) and set:

| Variable | Requirement |
|----------|-------------|
| `BETTER_AUTH_SECRET` | ≥32 chars; `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Public origin browsers use (`https://regs.example.com`) |
| `APP_ENCRYPTION_KEY` | 64 hex chars; `openssl rand -hex 32`; **back up offline** |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | First admin (≥8 char password); only creates user when users table empty |
| `POSTGRES_*` | Match compose DB credentials |

Optional publish ports: `APP_PUBLISH_PORT`, `POSTGRES_PUBLISH_PORT`.

## 2. Docker / Portainer stack

### Production (GHCR + Portainer)

1. Follow [deploy-portainer.md](./deploy-portainer.md): stack from `docker-compose.portainer.yml`, images `ghcr.io/finenumbers/reg:1.0.0` + `:1.0.0-migrator`.
2. External network `proxy` must already exist (NPM).
3. Confirm: `db` healthy → `migrate` exits 0 → `app` healthy (`/api/readyz`).
4. **Replicas:** keep a single `app` container (do not scale).

### Local build (optional)

1. Ensure `.env` exists next to `docker-compose.yml`.
2. `docker compose up -d --build`.
3. Same health order as above.

### NPM (Nginx Proxy Manager)

1. `app` must be on the external `proxy` network (`docker-compose.portainer.yml` does this by default; local compose: uncomment `proxy`).
2. Create Proxy Host → forward to `http://<app-service-or-container>:3000`.
3. Route **both** `/` and `/api` to that **same** upstream (one Next.js service).
4. Enable SSL on NPM; set `BETTER_AUTH_URL` to the HTTPS origin.
5. Forward real client IP (`X-Forwarded-For` / `X-Real-IP`) — NPM usually does this; needed for login rate limits / audit IP.

## 3. Database

1. `migrate` service runs `prisma migrate deploy` on each stack start (idempotent).
2. If this database was previously created with `db push` only, baseline once:

   ```bash
   npx prisma migrate resolve --applied 20260806100000_init
   ```

3. App startup also ensures RBAC/allowlist baseline + admin bootstrap from env.

## 4. Softswitch (before polling)

Follow [remote-server-setup.md](./remote-server-setup.md): dedicated user, forced `platform_exec.sh`, narrow sudoers/ACL, smoke SSH from ops host.

## 5. Application configuration

1. Login at `/login` with bootstrap admin.
2. **Settings:** SSH host/port/user; import key (PPK/PEM); **Test connection** (auth/session only).
3. **Registrations:** manual **Run poll** once; confirm `/jobs` and data on `/regs`.
4. Only then enable Settings **регулярный опрос** (`regsPollEnabled`) with a sane interval (still one replica).

## 6. Verify

```bash
BASE_URL=https://regs.example.com npm run smoke
```

Full operator checklist: [smoke-tests.md](./smoke-tests.md).

## 7. Backup

Schedule `pg_dump` (see [backup-and-restore.md](./backup-and-restore.md)) and store `APP_ENCRYPTION_KEY` in the same secrets vault as DB backups.

## 8. Auto-poll enablement (optional, later)

Only when all are true:

1. Single `app` replica
2. Softswitch forced command verified
3. SSH test OK
4. Manual poll OK
5. Settings `regsPollEnabled=true` + Save (interval ≥30s)

To disable auto-poll quickly: turn off `regsPollEnabled` in Settings and Save — ticks skip enqueue (no container restart).
