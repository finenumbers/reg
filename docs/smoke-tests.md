# Smoke tests

Lightweight checks after deploy or config change. Automated script + operator UI checklist.

## Automated

Against a running app:

```bash
# Local compose default
npm run smoke

# Production / NPM URL
BASE_URL=https://regs.example.com npm run smoke
```

What it verifies:

| Check | Expect |
|-------|--------|
| `GET /api/healthz` | 200 |
| `GET /api/readyz` | 200 (env + DB) |
| `GET /api/settings`, `/api/regs`, `/api/jobs`, `/api/audit` without session | 401 |

Optional authenticated checks (export cookies from a logged-in browser session):

```bash
BASE_URL=https://regs.example.com COOKIE_JAR=/tmp/reg-cookies.txt npm run smoke -- --auth
```

## Operator UI checklist

Complete after first production deploy and after major upgrades:

1. **App starts** — Portainer/`docker compose` shows `app` healthy; `readyz` OK.
2. **Auth** — `/login` with bootstrap admin; logout/login; wrong password rejected.
3. **Settings** — page loads; save host/port/user; key replace accepted; fingerprint shown; key never displayed.
4. **SSH test** — Test connection succeeds (auth/session only; does not poll regs).
5. **Manual poll** — `/regs` → Run poll; job appears on `/jobs`; regs update or failure is visible without corrupting prior good data on hard fail.
6. **Jobs / audit / regs** — `/jobs`, `/audit` (admin), `/regs` load with filters.
7. **Auto-poll off by default** — Settings `regsPollEnabled=false`; schedule jobs do not enqueue; manual poll still works. Status line shows planner active / poll disabled.
8. **Hardening** — mutating API from another origin fails CSRF; repeated login attempts rate-limit.
9. **Storage (admin)** — `/storage` shows month table (calls / seconds / minutes / delete). Minutes are the sum of per-call ceiled minutes, not total seconds / 60. Delete is only on the oldest complete month; confirm by typing `YYYY-MM`. Operator has no nav item; opening `/storage` as operator → `/forbidden`.
10. **Statistics** — `/stats` (admin and operator, `phones:read`) month switcher plus three SIP summaries (ТфОП = `PSTN_` except `_LDC`; long-distance = `PSTN_*_LDC`; external numbering = `Trunk_`) and platforms. Empty call/minute cells show «-». A call that matches several categories is counted in each.

## Softswitch (outside the app container)

Before enabling auto-poll, run the SSH host checks in [remote-server-setup.md](./remote-server-setup.md) (`whoami` must not give a shell).

## Auto-poll enablement smoke

Only after the checklist above:

1. Confirm **one** `app` container.
2. Settings → enable registrations and/or phones+groups on their own intervals (≥30s) → Save.
3. Watch `/jobs` for `trigger=schedule`; confirm phones and groups do not overlap with each other.
4. Rollback: disable `regsPollEnabled` in Settings → Save.
