# Backup and restore

Practical recovery notes for Reg (PostgreSQL + encrypted SSH secrets).

## What to back up

| Asset | Why |
|-------|-----|
| PostgreSQL database | Users, sessions, settings, SSH ciphertext, regs, jobs, audit |
| `APP_ENCRYPTION_KEY` | **Required** to decrypt SSH private keys after restore |
| `BETTER_AUTH_SECRET` | Session/cookie integrity; changing it invalidates sessions |
| Compose / Portainer stack env | Reproducible redeploy (store in a secrets vault, not git) |

Application container filesystem does **not** hold the SSH private key in plaintext. Losing only the DB without `APP_ENCRYPTION_KEY` still loses usable SSH credentials.

## Backup (compose)

Helper:

```bash
npm run backup:db
# or: ./scripts/backup-db.sh ./backups
```

Equivalent:

```bash
docker compose exec -T db pg_dump -U reg -d reg --no-owner --format=plain \
  | gzip -c > "backups/reg-pg-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
```

Adjust `-U` / `-d` if you changed `POSTGRES_USER` / `POSTGRES_DB`.

**Cadence:** at least daily for production ops DBs; retain enough copies for your RPO. Test a restore drill before go-live.

## Restore

1. Stop `app` (and avoid migrate races):  
   `docker compose stop app`
2. Restore into an empty or replaced database volume (destructive — confirm target):

   ```bash
   gunzip -c backups/reg-pg-YYYYMMDDThhmmssZ.sql.gz \
     | docker compose exec -T db psql -U reg -d reg
   ```

   For a clean volume: remove `reg_pg_data`, `docker compose up -d db`, wait healthy, recreate DB if needed, then restore, then start `migrate`/`app`.

3. Ensure the **same** `APP_ENCRYPTION_KEY` is set in the app environment as when keys were encrypted.
4. Start the stack: `docker compose up -d`
5. Smoke: `/api/readyz`, login, Settings shows `hasPrivateKey`, SSH test, optional manual poll.

### If `APP_ENCRYPTION_KEY` was rotated or lost

- Existing `privateKeyCiphertext` rows **cannot** be decrypted.
- Operator must **replace** the SSH private key in Settings (import again).
- Host `authorized_keys` must match the new public key.

## Disaster-recovery notes

1. **RPO/RTO:** define how much poll/history loss is acceptable; size dump cadence accordingly.
2. **Single replica:** restore is one `app` + one `db`; do not scale `app` during recovery.
3. **Scheduler:** leave Settings `regsPollEnabled=false` until restore + SSH test succeed.
4. **NPM:** DNS/TLS live on the proxy; app only needs to be reachable on the `proxy` network at port 3000.
5. **Audit/jobs history** live in Postgres — included in `pg_dump`.
6. **Migrations:** after restore of an older dump, run `migrate` / `prisma migrate deploy` so schema matches the image.

## Encrypted secrets checklist

- [ ] `APP_ENCRYPTION_KEY` stored offline / in vault (not only on the app host)
- [ ] Backup includes DB dump **and** confirmation that the key used for that dump era is known
- [ ] Restore drill documented with date of last successful test
