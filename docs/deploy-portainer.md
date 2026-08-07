# Deploy Reg with Portainer + external Nginx Proxy Manager (NPM)

Production path using **GHCR images** (linux/amd64) and the existing NPM `proxy` network.  
Compose file: [`docker-compose.portainer.yml`](../docker-compose.portainer.yml).  
Related: [production-checklist.md](./production-checklist.md), [remote-server-setup.md](./remote-server-setup.md).

## Images (redeploy)

| Role | Image |
|------|--------|
| App | `ghcr.io/finenumbers/reg:latest` |
| Migrate | `ghcr.io/finenumbers/reg:latest-migrator` |

Versioned tags (`1.0.0`, …) are published by CI for reference only — **Portainer stack always uses `latest` / `latest-migrator`**.

Package: [ghcr.io/finenumbers/reg](https://github.com/finenumbers/reg/pkgs/container/reg).

## 1. Prerequisites

1. Docker host with **Portainer** and **Nginx Proxy Manager** already running.
2. External Docker network named **`proxy`** that NPM containers use:

   ```bash
   docker network ls | grep proxy
   # if missing (NPM usually creates it):
   docker network create proxy
   ```

3. Softswitch scripts installed per [remote-server-setup.md](./remote-server-setup.md) (`/opt/scripts/…`).

## 2. Stack env

In Portainer (Stack → Environment variables) or a `.env` file next to the compose:

| Variable | Notes |
|----------|--------|
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` (≥32 chars; no placeholders) |
| `BETTER_AUTH_URL` | Public HTTPS origin, e.g. `https://regs.example.com` |
| `APP_ENCRYPTION_KEY` | `openssl rand -hex 32` — **back up offline** |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | First admin (password ≥8); only when users table empty |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Strong DB password in production |

Do **not** set an image tag override — compose pins `latest` / `latest-migrator` only.

## 3. Portainer stack

1. **Stacks → Add stack**.
2. Name e.g. `reg`.
3. Paste contents of `docker-compose.portainer.yml` (or pull from Git: repo `finenumbers/reg`, path `docker-compose.portainer.yml`, branch `main`).
4. Set environment variables from the table above.
5. **Deploy the stack**.
6. Wait: `db` healthy → `migrate` exits 0 → `app` healthy.

Confirm:

```bash
docker compose -f docker-compose.portainer.yml ps
# or from Portainer: open app container logs / health
curl -fsS https://regs.example.com/api/readyz
```

**Replicas:** keep exactly **one** `app` container. Do not scale.

## 4. NPM (Nginx Proxy Manager)

1. Ensure the `app` service is on the external **`proxy`** network (already in `docker-compose.portainer.yml`).
2. Find the app container name on that network (Portainer → Containers, or `docker network inspect proxy`). Typical pattern: `reg-app-1` or `<stack>_app`.
3. **Hosts → Proxy Hosts → Add**:
   - Domain: `regs.example.com` (your DNS)
   - Scheme: `http`
   - Forward hostname: **service/container name** of `app` (e.g. `reg-app-1` or the Compose service name reachable on `proxy`)
   - Forward port: **`3000`**
4. Route **both** `/` and `/api` to that **same** upstream (one Next.js process — do not split).
5. Enable **SSL** (Let's Encrypt or your cert).
6. Keep **Block Common Exploits** / Websockets as needed; Websockets not required for v1 UI.
7. Ensure client IP headers (`X-Forwarded-For` / `X-Real-IP`) — NPM default is usually fine (login rate limits / audit).

Set `BETTER_AUTH_URL` to the exact public origin (`https://regs.example.com`) and redeploy/restart `app` if you change it.

## 5. After first boot

1. Open `https://regs.example.com/login` with bootstrap admin.
2. **Settings:** SSH host/user/key → **Test connection**.
3. **Registrations:** manual poll once; check `/jobs` and `/regs`.
4. **Phones:** sync once after softswitch `export.py` is installed.
5. Only then enable Settings auto-poll (`regsPollEnabled`) — still one replica.

## 6. Upgrades / redeploy

1. In Portainer: **Pull and redeploy** the stack (or `docker compose -f docker-compose.portainer.yml pull && docker compose -f docker-compose.portainer.yml up -d`).
2. Images stay `latest` / `latest-migrator` — no tag changes in compose.
3. Migrate runs before app on each redeploy.
4. Smoke: `/api/readyz` + login.

## 7. Must not

- Publish `app:3000` or Postgres to the public internet (this compose does not map host ports).
- Run multiple `app` replicas.
- Lose `APP_ENCRYPTION_KEY` while keeping the same database volume.
