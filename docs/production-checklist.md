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

| Variable                            | Requirement                                                              |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `BETTER_AUTH_SECRET`                | ≥32 chars; `openssl rand -base64 32`                                     |
| `BETTER_AUTH_URL`                   | Public origin browsers use (`https://regs.example.com`)                  |
| `APP_ENCRYPTION_KEY`                | 64 hex chars; `openssl rand -hex 32`; **back up offline**                |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | First admin (≥8 char password); only creates user when users table empty |
| `POSTGRES_*`                        | Match compose DB credentials                                             |

Optional publish ports: `APP_PUBLISH_PORT`, `POSTGRES_PUBLISH_PORT`.

## 2. Docker / Portainer stack

### Production (GHCR + Portainer)

1. Follow [deploy-portainer.md](./deploy-portainer.md): stack from `docker-compose.portainer.yml`, images `ghcr.io/finenumbers/reg:latest` + `:latest-migrator` only.
2. External network `proxy` must already exist (NPM).
3. Confirm: `db` healthy → `migrate` exits 0 → `app` healthy (`/api/readyz`).
4. **Replicas:** keep a single `app` container (do not scale). v1.98.0 resumes an interrupted month purge on startup when that month's calls are already gone; a second replica would start the same resume twice.

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

v1.173.0 does not migrate. Stop `app` before the update and start one new process only. Do not stop `smg-syslog`. Parser version 9 deletes every SMG syslog card once, blanks stored CDR antifraud labels in pages of 2000, deletes every `radius_calls` row once, and does not move the Parking byte cursor. It then marks the end of the newest syslog file and does not read the archive. A leftover v1.172.0 process writes version-8 cards back if it is still running. A later restart does not repeat the journal delete. After the cut, stored SMG antifraud labels are «Нет данных» / «Неизвестно» until bytes after the mark build a new card. Delay cells stay empty until then. «Таймаут АнтиФрода» fills only from new Parking rows. Month delete also removes that UTC journal, the cards of that SMG month, and their delay arrays. Undated journal rows are outside month delete. `VACUUM FULL` includes `radius_calls` and `smg_call_traces`. Delay headers are «Dev AF», «Prod AF», and «Parking». «Трафик SMG» drops «Минуты» and keeps «Секунды». Rolling back does not restore the deleted cards or journal rows.

v1.172.0 does not migrate and does not delete syslog cards. Do not stop `app`. Do not stop `smg-syslog`. Parser version stays 8. The call panel lists every sent Radius request, including a resend of the same Request ID. A timed-out send says «нет ответа». The reply and its milliseconds stay on the send that received them. Delay columns, the category, and the status are unchanged. Rollback to v1.171.0 restores one summary line per server and does not delete cards.

v1.171.0 does not migrate. Stop `app` before the update and start one new process only. Do not stop `smg-syslog`. Parser version 8 deletes every SMG syslog card once, drops checkpoints that are not version 8, marks the end of the newest file, and does not read the archive. The wipe also blanks stored CDR antifraud labels, so existing rows stay «Нет данных» until bytes after the mark build a new card. «Ответы АнтиФрода» and «Задержка АнтиФрода» lose that history. «Таймаут АнтиФрода» and the Parking journal stay. A leftover v1.170.0 process writes version-7 cards back if it is still running. Delay headers in both SMG tables and both workbooks are «Вход Dev», «Вход Prod», and «Parking». «Выход Dev» and «Выход Prod» are gone. Rolling back to v1.170.0 deletes the version-8 cards and does not restore them.

v1.170.0 does not migrate and does not rewrite stored rows. Do not stop `app`. Do not stop `smg-syslog`. There is no new index. «Трафик SMG» and «Данные SMG» show the Settings node name for a CDR «Узел» whose `lower(btrim(device_sign))` equals that node's identifier. A node is listed only when the month has its calls. Blank and unknown signs share «Нет данных» when such calls exist. An empty Device Sign is now stored. The next `smg.import` rereads inbox files that were held for «пустой узел», inserts those rows, and deletes a file that has no other bad line. Do not empty the inbox before the update. A file already deleted is not recovered.

v1.169.0 adds `antifraud_enabled BOOLEAN NOT NULL DEFAULT true` on `smg_syslog_nodes`. Stop `app` before the update and start one new process only after `migrate` exits. The migration does not rewrite CDR rows, syslog cards, or checkpoints, and it does not index `smg_cdr_records`. Do not stop `smg-syslog`. Existing nodes stay enabled. If the new app starts before `migrate`, the trace drain's node query fails the whole tick and no gateway gets a card. Settings → Syslog — SMG gains «АнтиФрод» per node, on by default. Off requires an identifier; the identifier cannot be cleared while off. Reception continues. That IP is not assembled, and its checkpoint does not move. Both SMG antifraud columns and both workbooks say «Нет АнтиФрода», delay cells stay empty, and the panel does not show the card. «Ответы АнтиФрода» and «Задержка АнтиФрода» omit the node. «Таймаут АнтиФрода» and the Parking journal stay as they are. Turning the box on resumes from the frozen checkpoint, one slot per drain tick. Rolling the app back leaves the column; the old drain ignores the flag and assembles again.

v1.168.2 does not migrate and does not rewrite stored rows. Do not stop `smg-syslog`. The color legend on «Ответы АнтиФрода» and «Задержка АнтиФрода» sits below the minute labels.

v1.168.1 does not migrate and does not rewrite stored rows. Do not stop `smg-syslog`. «Задержка АнтиФрода» reads the three millisecond arrays from the one card on a call. v1.168.0 failed that query before any row was read.

v1.168.0 adds stored antifraud labels on `smg_cdr_records` (`unique_tag_norm`, `radius_session_norm`, `af_category`, `af_status`) and three indexes, then nullable delay arrays on `smg_call_traces`, `cdr_timezone` default `UTC` on `smg_syslog_nodes`, and an index on `smg_cdr_records(setup_time)`. Stop `app` before the update and start one new process only after `migrate` exits. The indexes block writes on `smg_cdr_records` and do not rewrite stored call text. The migrations do not fill the new values. `smg-syslog` keeps writing. Cards are not deleted. After `app` is up, the drain fills null CDR labels, newest first, and null delay arrays in batches of 200. A CDR row whose category is still null is absent from «Ответы АнтиФрода». Set «Пояс CDR» on each Syslog SMG node to the gateway clock; until then the answers and delay charts treat `setup_time` as UTC. A node whose identifier does not match the CDR «Узел» is omitted from those two charts. «АнтиФрод» displays UTC. Delay headers in both SMG tables are «Вход Dev», «Вход Prod», «Выход Dev», «Выход Prod», and «Parking».

v1.146.0 deletes every SMG syslog card and trace checkpoint. Stop the `app` container before updating the stack. The previous process still reads the archive; if it is running when the tables are emptied, it writes those cards back.

v1.148.0 deletes those cards again, from the running process, with no migration. Stop `app` before updating. The previous process still writes version-3 cards; if it is running when the cards are deleted, it writes them back. `smg-syslog` keeps writing.

v1.149.0 does not rewrite stored rows and does not delete syslog cards. There is no migration. If v1.148.0 is already running, do not stop `app` for this update.

v1.150.0 does not rewrite stored rows and does not delete syslog cards. There is no migration. Do not stop `app` for this update. SMG xlsx export refuses a machine API key. The dashboard syslog card limits its antifraud count to 8 seconds and shows «…» when that read fails. v1.150.0 did not publish an image.

v1.151.0 publishes that same behavior. There is no migration. Do not stop `app` for this update. SMG xlsx export refuses a machine API key. The dashboard syslog card limits its antifraud count to 8 seconds and shows «…» when that read fails.

v1.167.0 deletes every SMG syslog card once, from the running process, with no migration. Stop `app` before updating. Parser version 7 drops checkpoints that are not version 7 and does not read their JSON. The first turn deletes every card, marks the end of the newest file, and does not read the archive. The previous process still writes version-6 cards; if it is running when the cards are deleted, it writes them back. `smg-syslog` keeps writing. The Parking journal stays. Existing CDR rows stay «Нет данных». A call already in progress gets a card only from bytes read after the mark. «Трафик SMG» drops «Тип входа» and «Тип выхода». Both SMG tables gain «1 Dev», «1 Prod», «2 Dev», «2 Prod», and «Parking» from the card's reply delay. Rolling back to v1.166.0 deletes cards again and does not restore them.

v1.166.0 adds the АнтиФрод load-clock columns and the Parking host, user, and log path. Stop `app` before the update so both migrations finish before the new app starts. `radius_calls` is not rewritten. Syslog cards are not deleted. `smg-syslog` keeps writing. Do not change the log server. A key already stored does not need to be uploaded again. The host, user, and log path are edited under Settings → «Доступ к Parking».

v1.165.0 adds `parking_ssh_secrets`, `radius_ingest_states`, `radius_ingest_gaps`, and `radius_calls`. Stop `app` before the update so `migrate` finishes before the new app starts. CDR rows are not rewritten. Syslog cards are not deleted. `smg-syslog` keeps writing. After `app` is up, upload the Parking key in Settings. The app container needs outbound TCP 22 to `parking.finenumbers.com`. Do not change that server. Until the key is stored, «АнтиФрод» stays empty.

v1.164.0 does not delete syslog cards. There is no migration. Do not stop `app` for this update. Parser version stays 6 and the archive is not reread. A call released before `Set UniqueTag` gets a card when the bytes already read contain the antifraud start and a real tag. A span already dropped does not come back. The drain rewrites stored antifraud labels from the card text in batches of 200 and then stops. The call panel shows the server summary above a monospace copy of the syslog. The shared secret stays in that copy and stays out of the summary.

v1.163.0 does not rewrite stored rows and does not delete syslog cards. There is no migration. Do not stop `app` for this update. «Трафик SMG» keeps the date filter and moves the start-stamp chevron to «Время». Phone search still matches four numbers; the yellow mark is only on «А выход», «Б выход», and «Переадресация». A migration that does not name the tariff backfill does not make `migrate` scan `cdr_records`. The tariff job and the blocking script turn statement and lock timeouts off on their own session. The app pool keeps the 5 second lock timeout.

v1.162.0 does not rewrite stored rows and does not delete syslog cards. There is no migration. Do not stop `app` for this update. The navigation panel shows «Данные SMG» and «Архивы Syslog». Page headings, Excel names, dashboard cards, and the postponed-file line stay on the previous names.

v1.161.0 adds nullable `af_category` and `af_status` on `smg_call_traces`. Stop `app` before updating. `smg-syslog` keeps writing. Cards are not deleted. Parser version stays 6 and the archive is not reread. The trace drain fills null labels in batches after the new app starts. An old process that saves a card after that fill leaves a stale label, because the backfill only selects nulls. «Трафик SMG» filters «Дата», «Переадресация», «АнтиФрод», and «Статус АнтиФрод», and the date chevron orders by the start stamp. Reset returns disconnect order. CDR rows are not rewritten.

v1.160.0 deletes every SMG syslog card once, from the running process, with no migration. Stop `app` before updating. Parser version 6 drops checkpoints that are not version 6 and does not read their JSON. The first turn deletes every card, marks the end of the newest file, and does not read the archive. The previous process still writes version-5 cards; if it is running when the cards are deleted, it writes them back. `smg-syslog` keeps writing. Existing CDR rows stay «Нет данных». A call already in progress does not get a card. Bytes appended after the mark are read in file order: the next slot waits until the current file is gzipped and read from its start, and a card is not replaced by a shorter text. A discarded RADIUS digest is not a verdict. A timeout that continues the call is not an antifraud release.

v1.159.0 does not rewrite stored rows and does not delete syslog cards. There is no migration. Do not stop `app` for this update. Parser version stays 5. `smg-syslog` keeps writing. An open card is «Не отправлялся» / «Не было запроса» when a post-route `RREQ 4` and an `RREQ 5` are both entirely `USE_AF 0, SD 0, OS 0`, with no `USE_AF 1` and no sent `Request ID`. Trunk `0(ext)` counts. The pre-route `-1(loc)` line does not. One stage, another `RREQ` on a chosen trunk, or a mismatched card stays «Ожидание АнтиФрода» until the card closes. The next list load moves those open calls out of «Ожидание АнтиФрода». A later `USE_AF 1` or sent request drops «Не отправлялся» on the next read.

v1.158.0 adds `dial_exceptions` and replaces `cdr_tariff_length_mismatch`. `migrate` does not walk the journal. It moves `rateGeneration` ahead, and the app job rewrites stored category, type, direction, and charge after `app` is up. A redeploy with no new migration does not read `cdr_records`. Do not stop `app` beyond the normal stack update. Syslog cards stay. «Исключения» lists digit ABC codes. The seed is `0`, `83`, `89`, `887`, `889`. The longest code wins. An outgoing B-number that contains `*` or `#` is «Ошибка» / «Проверить»; those symbols are not rows in the list. A redirect to `*` stays «Редирект».

v1.157.0 replaces `cdr_tariff_length_mismatch`. The tariff backfill rewrites stored category, type, direction, and charge before `app` starts. Do not stop `app` beyond the normal stack update. Syslog cards stay. An outgoing B-number that starts with `0`, `83`, `89`, `887`, `889`, or `*` becomes «Ошибка» / «Проверить» unless the loaded tariff has an ABC on that same prefix whose length fits. A shorter ABC does not cover it. A number on `*` is always an error. `880` and `33` stay as they are. Direction and charge are cleared only when a shorter foreign ABC was rating the call.

v1.156.0 replaces `tariff_rates.digitLength` with text `digitLengths` and replaces `cdr_rate_call`, `cdr_tariff_direction`, `cdr_call_category`, and `cdr_call_type`. The tariff backfill rewrites stored category, type, direction, and charge before `app` starts. Do not stop `app` beyond the normal stack update. Syslog cards stay. An 11-digit B-number that starts with `7` and has no ABC on `7` in the loaded tariff becomes «Ошибка» / «Проверить». Do not deploy this onto an empty `tariff_rates`. A cell `12/13` means either length and must be Excel text. Belarus stored as a single 12 stays a single 12 until that file is uploaded; the upload runs the backfill again.

v1.155.0 adds `tariff_rates.digitLength` and replaces `cdr_rate_call` and `cdr_tariff_direction`. The tariff backfill rewrites stored direction and charge before `app` starts. Do not stop `app` beyond the normal stack update. Syslog cards stay. After the app is up, upload the tariff file that includes «Разрядность». Until that import, an international ABC already in the snapshot with an empty length matches every admitted number (10–15 digits, and a number starting with `7` only when it is 11). Russian ABC `73`/`74`/`78`/`79` still match only 11 digits. A three-column tariff file is rejected.

v1.154.0 does not rewrite stored rows and does not delete syslog cards. There is no migration. Do not stop `app` for this update. The Settings month table gives Syslog the same width as Звонки, Секунды, and Минуты, and shows the header line between Минуты and Syslog. Both dashboard call charts show eight UTC times (`HH:MM`) on the horizontal axis.

v1.153.0 does not rewrite stored rows on startup and does not delete syslog cards by itself. There is no migration. Do not stop `app` for this update. `smg-syslog` keeps writing. Month deletion in Settings removes CDR calls, the antifraud cards of the SMG calls in that month, those SMG calls, that month's syslog archives, then jobs and audit. A card shared with an SMG call outside the month stays. The current UTC month cannot be deleted.

v1.152.0 deletes every SMG syslog card once, from the running process, with no migration. Stop `app` before updating. Parser version 5 drops checkpoints that are not version 5 and does not read their JSON. The first turn deletes every card, including a gateway that no longer has a syslog directory, then marks the end of the newest file and does not read the archive. The previous process still writes version-4 cards; if it is running when the cards are deleted, it writes them back. `smg-syslog` keeps writing. Existing CDR rows stay «Нет данных» until a new call is assembled. An open card shows the antifraud result once every sent request has a verdict. «Ожидание АнтиФрода» stays when no request was sent or a sent request still has no verdict.

1. `migrate` service runs `prisma migrate deploy`, then the CDR category/status backfill, on each stack start (idempotent). v1.64.0 rewrites old `dst_name = Service_Check` rows and already stored `dp_name = Service_Check` / sides starting with `Тест ` before `app` starts. v1.67.0 rewrites stored status «Неуспешный» to «Неуспешные» before `app` starts. v1.90.0 rewrites «Местный (П)», «Междугородный (П)», «Международный (П)», category «Паркинг», and «Ошибка», then sets status «Паркинг» on successful redirect and check rows whose `dst_name` is `Service_Parking`. v1.91.0 adds `call_type` and rewrites «Местный», «Междугородный», «Международный», and «Редирект» into «Исходящие», fills the type, and renames stored «Неуспешные». v1.92.0 replaces `cdr_rate_call` so 0–3 ceiled seconds are 0 minutes, and the tariff backfill rewrites stored charge for those rated calls to `0.00` before `app` starts. v1.93.0 adds type «Мобильный», folds «Ошибка маршрута», «Нет регистрации», and «Проверить» into category «Ошибки», and the tariff backfill rewrites category, type, status, and charge before `app` starts. v1.94.0 renames stored «Исходящие» to «Исходящий» and «Ошибки» to «Ошибка», fills direction on failed outgoing calls, and leaves stored charges unchanged. The category backfill no longer treats «Ошибка» as a leftover label. v1.96.0 classifies `Class4, 5 - Terminator Capacity Exceeded` as «Ошибка» / «Канальность», and the tariff backfill clears direction, price, and charge on rows that were rated outgoing. v1.97.0 adds indexes for month-purge job deletion and does not rewrite stored rows. `CREATE INDEX` on `cdr_records` blocks writers until it finishes; deploy when CDR import can wait. `npx prisma migrate deploy` alone leaves stored rows unchanged. Confirm with `SELECT version FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1` → `20261010200000_purge_fk_indexes`.
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
4. **Incoming groups / phones:** load groups once, then phones sync; spot-check XLSX «Группы» has no duplicate IDs.
5. Only then enable Settings regular registrations poll and/or phones+groups load (separate intervals; still one replica).

**Sync data-loss note:** regs/phones/groups apply is full-replace. An empty dump is rejected when the table is non-empty, but a **truncated non-empty** softswitch dump (exit 0) can still wipe missing rows. After an anomalous sync, check `/jobs` (stderr/artifact) before trusting the snapshot.

## 6. Verify

```bash
BASE_URL=https://regs.example.com npm run smoke
```

Full operator checklist: [smoke-tests.md](./smoke-tests.md).

## 7. Backup

Schedule `pg_dump` (see [backup-and-restore.md](./backup-and-restore.md)) and store `APP_ENCRYPTION_KEY` in the same secrets vault as DB backups.

Do **not** run the «Хранение данных» month purge on `/settings` without a recent dump. Deleted CDR rows stay gone after a restart (job may show `interrupted`). A new purge deletes the oldest month that still has calls. It does not finish jobs and audit for a month whose calls are already gone. Disk space is not returned by the purge. Autovacuum may reuse freed pages inside the table. «Сжать базу» is the separate step that runs `VACUUM FULL` on `cdr_voipmonitor_links` and `cdr_records` only. It copies live rows. It needs free space on the Postgres volume of at least twice those two relations, because the new copy and its WAL sit beside the old files until the command commits. Traffic pages answer that compression is running instead of waiting on the lock. A restart aborts the current table and does not resume it.

Migration `20260831180000_cdr_day_index` builds `cdr_records_cdr_day_idx`. Migration `20261010200000_purge_fk_indexes` builds the purge foreign-key indexes, including `cdr_records_lastJobRunId_idx`. On a large heap each `CREATE INDEX` (non-`CONCURRENTLY`) briefly locks writers. Schedule the deploy when import load is low. Do not deploy it while a purge is still running if that purge should finish its job and audit stages.

## 8. Auto-poll enablement (optional, later)

Only when all are true:

1. Single `app` replica
2. Softswitch forced command verified
3. SSH test OK
4. Manual poll OK
5. Settings `regsPollEnabled=true` + Save (interval ≥30s)

To disable auto-poll quickly: turn off `regsPollEnabled` in Settings and Save — ticks skip enqueue (no container restart).
