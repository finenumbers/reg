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

## 2. Stack env (required)

In Portainer open the stack → **Environment variables** and add (Advanced mode / name=value).  
**Do not** rely on a `.env` file — Git-based stacks have no `/data/compose/…/.env` on disk (that caused deploy failures).

| Variable | Notes |
|----------|--------|
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` (≥32 chars; no placeholders) |
| `BETTER_AUTH_URL` | Public HTTPS origin, e.g. `https://regs.example.com` |
| `APP_ENCRYPTION_KEY` | `openssl rand -hex 32` — **back up offline** |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | First admin (password ≥8); only when users table empty |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Strong DB password in production |

Do **not** set an image tag override — compose pins `latest` / `latest-migrator` only.
Do **not** commit real secrets. Use `.env.example` only as a checklist of names.

## 3. Portainer stack

1. **Stacks → Add stack**.
2. Name e.g. `reg`.
3. Paste contents of `docker-compose.portainer.yml` (or pull from Git: repo `finenumbers/reg`, path `docker-compose.portainer.yml`, branch `main`).
4. Under **Environment variables**, set every key from the table in §2 (especially `POSTGRES_PASSWORD`, `BETTER_AUTH_*`, `APP_ENCRYPTION_KEY`).
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
2. **Settings:** SSH host/user/key → **Test connection**. If GeoIP Analytics runs on **this same Docker host**, set the GeoIP URL per [§6](#6-geoip-on-the-same-docker-host) before relying on country/city/ISP columns. If PSTN Analytics is on the same host, set the PSTN URL per [§7](#7-pstn-on-the-same-docker-host) before «Обогатить данные».
3. **Registrations:** manual poll once; check `/jobs` and `/regs`.
4. **Phones:** sync once after softswitch `export.py` is installed.
5. Only then enable Settings auto-poll (`regsPollEnabled`) — still one replica.

## 6. GeoIP on the same Docker host

The `app` container must not call the **public** GeoIP HTTPS origin (`https://geoip.finenumbers.com`). That resolves to the host’s public IP (`5.227.161.190:443` here). Docker hairpin NAT typically fails: Node `fetch` waits ~10s then `UND_ERR_CONNECT_TIMEOUT` / UI «fetch failed». The same URL works from a laptop (different path).

Lookup is **`geoip_api`** (internal port **3000**), not `geoip_web` (published `8080→80`). Those GeoIP containers are **not** on `proxy` until you attach the API.

One-shot (lost on container recreate unless the **GeoIP** compose also lists `proxy`):

```bash
docker network connect proxy geoip_api
```

Settings → GeoIP → URL: **`http://geoip_api:3000`**. Save, then **Check connection**.

Do **not** clear the URL field. An empty save stores the default `https://geoip.finenumbers.com` and the timeout comes back.

Probe from `reg-app-1` (no curl in the image). `401` without a key means the path works:

```bash
node -e 'fetch("http://geoip_api:3000/api/v1/lookup",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}).then(async r=>console.log("status",r.status,await r.text())).catch(e=>console.error(e.cause||e))'
```

## 7. PSTN on the same Docker host

The `app` container must not call the **public** PSTN HTTPS origin (`https://pstn.finenumbers.com`). That resolves to the host’s public IP. Docker hairpin NAT typically fails: Node `fetch` waits ~10s then `UND_ERR_CONNECT_TIMEOUT` / UI «fetch failed». The same URL works from a laptop (different path).

Lookup is **`pstn_app`** (internal port **5555**). The PSTN Portainer compose already attaches `pstn_app` to `proxy`. If DNS from `reg` app fails, attach once (lost on container recreate unless the PSTN compose lists `proxy`):

```bash
docker network connect proxy pstn_app
```

Settings → PSTN → URL: **`http://pstn_app:5555`**. Save, then **Check connection**. Leave the API key as-is.

Do **not** clear the URL field. An empty save stores the default `https://pstn.finenumbers.com` and the timeout comes back.

Probe from `reg-app-1` (no curl in the image). `401` without a key means the path works:

```bash
node -e 'fetch("http://pstn_app:5555/api/v1/lookup?phone=4996660000").then(async r=>console.log("status",r.status,await r.text())).catch(e=>console.error(e.cause||e))'
```

## 8. Upgrades / redeploy

1. In Portainer: **Pull and redeploy** the stack (or `docker compose -f docker-compose.portainer.yml pull && docker compose -f docker-compose.portainer.yml up -d`).
2. Images stay `latest` / `latest-migrator` — no tag changes in compose.
3. Migrate runs before app on each redeploy.
4. Smoke: `/api/readyz` + login.

Large CDR enrich uploads (tens of MiB) were silently truncated to **10 MiB** by Next.js middleware body clone, not by NPM (`client_max_body_size` default is 2000m). v1.5.3 excludes `/api/enrich` from the matcher and rejects an incomplete multipart. After redeploy, re-upload the full CSV.

## 9. Must not

- Publish `app:3000` or Postgres to the public internet (this compose does not map host ports).
- Run multiple `app` replicas.
- Lose `APP_ENCRYPTION_KEY` while keeping the same database volume.
