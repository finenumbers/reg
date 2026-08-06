# Security Model

Жёсткие требования безопасности для платформы, работающей по SSH с продуктивным softswitch. SSH-пользователь на сервере может иметь sudo «по жизни»; приложение **не имеет права** использовать это как общий shell.

Бизнес- и SSH-ограничения ниже **не зависят** от смены стека (Next.js / Better Auth / p-queue). Меняется только способ AuthN на стороне приложения.

## 1. Threat model (кратко)

| Угроза | Контрмера |
|--------|-----------|
| Произвольная команда с UI/API | Allowlist actionId only; нет полей command/path |
| Shell injection / argument injection | `ssh.exec` без shell; argv пустой; path — константа |
| Path traversal (`../`) | Regex `^/opt/scripts/[A-Za-z0-9._-]+$` |
| Использование account как general-purpose SSH | Forced command / wrapper; no agent/port forwarding; PTY only for allowlisted script exec |
| Злоупотребление sudo | App шлёт только константу `/usr/bin/sudo -n -- <allowlisted path>` из кода; на ОС — NOPASSWD только на точный script path; запрет произвольного sudo из UI |
| Утечка private key | AES-256-GCM at rest; decrypt только in-memory; не логировать; UI mask; нет export |
| Подмена ключа/настроек | RBAC; audit log |
| CSRF | Session cookies Better Auth (httpOnly, Secure, SameSite) + проверка Origin/CSRF на mutating requests |

## 2. Три слоя контроля удалённого выполнения

### Слой A — Application allowlist (обязательный)

В коде платформы (и seed БД, синхронизированный с кодом) существует реестр действий:

| action code | remote path | argv | exec command |
|-------------|-------------|------|--------------|
| `regs.poll` | `/opt/scripts/check_regs.sh` | `[]` | `/bin/bash -c 'cd /opt/scripts && exec /usr/bin/sudo -n -- ./check_regs.sh'` (PTY) |
| `phones.sync` | `/opt/scripts/export.py` | `[]` | `/bin/bash -c 'cd /opt/scripts && exec /usr/bin/sudo -n -- ./export.py'` (no PTY) |

`phones.sync` — read-only `SELECT` в MySQL softswitch; JSON в stdout; **без** записи `export.xlsx` и без SFTP.

Правила:

1. Клиент передаёт только `actionId` / `actionCode`.
2. Путь **не** приходит из UI, query, body, headers, БД-редактируемых админкой полей.
3. Изменение remote path для production-action — только через релиз кода + миграцию/seed, не через «форму настроек».
4. Executor использует библиотеку `ssh2` метод исполнения команды **без** interactive shell и без `/bin/sh -c`.
5. Defense in depth: даже константный path проходит валидатор `/opt/scripts/[A-Za-z0-9._-]+`.

### Слой B — SSH forced command / remote wrapper (обязательный на softswitch)

**Решение (утверждено):** сразу wrapper `/opt/scripts/platform_exec.sh`.

В `authorized_keys` для ключа платформы:

```text
command="/opt/scripts/platform_exec.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding ...
```

Wrapper:

- принимает только allowlisted `SSH_ORIGINAL_COMMAND` для `check_regs.sh` и `export.py`: bare path, absolute `sudo -n -- …`, или fixed bash -c cwd form;
- делает `cd /opt/scripts` и `exec /usr/bin/sudo -n -- ./<basename>`;
- иначе exit non-zero.

PTY для platform key **разрешён** (не ставить `no-pty`): `check_regs.sh` в non-TTY режиме отдаёт другой результат, чем в интерактивном терминале. App запрашивает PTY только для allowlisted exec; interactive shell по-прежнему недоступен из‑за forced command.

### Слой C — OS least privilege / sudo risk

Факт: скрипт может требовать доступ к файлам вроде `/etc/mvts3g/access-db.conf` и зависит от cwd `/opt/scripts`.

**Решение (утверждено, обновлено):** sudo на softswitch **разрешён**, узко; приложение **отправляет** константный `sudo -n` из `/opt/scripts`.

1. На ОС: `sudoers` NOPASSWD **только** на скрипты из allowlist (`/opt/scripts/check_regs.sh`, `/opt/scripts/export.py`).
2. Приложение строит sudo-команду **только** в коде allowlist (`cd /opt/scripts && sudo -n -- ./<script>`), никогда из UI/настроек/произвольного ввода.
3. Запрещено: `sudo ALL`, произвольный sudo, user-controlled аргументы, sudo-строка из форм.

Цепочка: app allowlist → SSH exec (`bash -c 'cd /opt/scripts && sudo -n -- ./…'`, PTY только если `needsPty`) → (optional forced `platform_exec.sh`) → sudoers → script.

`export.py` — только чтение MySQL; пароли регистраций в ответе/таблице phones хранятся и показываются открытым текстом (доступ через RBAC `phones:read`).

## 3. PuTTYgen (.ppk) и секреты

### Hard requirement

Settings UI обязана принимать private keys, сгенерированные PuTTYgen (`.ppk`), в т.ч. с passphrase.  
После сохранения ключ **нельзя скачать/посмотреть** — только заменить.

### Import pipeline

1. Upload файла или paste (лимит размера, например 64 KiB).
2. Detect: `PuTTY-User-Key-File-2/3` vs OpenSSH/PEM.
3. Decrypt PPK/PEM с passphrase (если есть) **в памяти**.
4. Normalize → OpenSSH/PEM private key (внутренний формат платформы).
5. Validate loadability (парсер ключа).
6. Encrypt normalized key через AES-256-GCM с `APP_ENCRYPTION_KEY`.
7. Сохранить ciphertext + fingerprint + key algorithm metadata.
8. **Не сохранять** оригинальный `.ppk` и **не сохранять** passphrase после успешного импорта (passphrase нужна только на этапе import/replace).

**Реализация Phase 3:** модуль `src/modules/ssh/import-key.ts`.

- PEM/OpenSSH: `sshpk`
- `.ppk` (включая encrypted PPK v3 / Argon2): `ppk-to-openssh`  
  Причина: `sshpk` **не** расшифровывает encrypted PPK v3 (современный default PuTTYgen).  
  Лицензия `ppk-to-openssh`: GPL-3.0 — зафиксированный tradeoff для hard requirement PPK; для внутреннего ops-приложения обычно приемлемо, но нужно учитывать при внешнем распространении бинарника/исходников.

Ciphertext envelope в БД: `v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>`.

### Runtime

- Decrypt только непосредственно перед SSH-сессией.
- Не писать key material на filesystem контейнера.
- Не включать key/passphrase в логи, audit detail, error messages клиенту сверх безопасных кодов ошибок.

### Test connection

- Phase 3+: проверяет **только** reachability + authentication + session establishment (`ssh2` connect/ready).
- **Не** выполняет `check_regs.sh` / `regs.poll` и **не** обновляет `reg_current` / history.
- Пишет результат в `ssh_connection_tests` + audit `ssh.test`.

### Allowlisted business exec (Phase 4)

- Только action code `regs.poll` → константный path `/opt/scripts/check_regs.sh`, argv `[]`.
- Реализация: `sshClient.execAllowlisted` + `SshAllowlistedRemoteExecutionService` + jobs processor.
- Клиент/API **не** передаёт `command` / `scriptPath` / `remoteArgs`.
- Manual poll: `POST /api/regs/poll` (permission `regs:poll`) ставит задачу в `p-queue`; anti-overlap обязателен.
- Auto-scheduler: in-process loop always starts at boot; ticks enqueue only when Settings `regsPollEnabled=true` (interval from `regsPollIntervalSec`, min 30s). Single `app` replica required.

## 4. AuthN / AuthZ

**Утверждено (Q2 + Q11):** только локальные пользователи через **Better Auth** (password plugin / email-or-username). SSO/LDAP не в v1.

- Пароли: хеширование через Better Auth (не хранить plaintext).
- Сессия: cookie-based session Better Auth (httpOnly, Secure в prod, SameSite); модели `session` / `account` / `verification` в БД по схеме Better Auth + Prisma adapter.
- Кастомный JWT access/refresh стек и отдельная таблица `refresh_tokens` **не** используются.
- RBAC поверх Better Auth (роли/permissions в собственных таблицах, привязка к user id):
  - `admin` — settings, ключи, users, audit
  - `operator` — просмотр регистраций, manual poll (без смены SSH-ключей)
- Permissions (примеры): `settings:write`, `ssh:test`, `regs:read`, `regs:poll`, `audit:read`, `users:admin`

Разделение «configuration privilege» и «execute/read privilege» обязательно с первого релиза.

Bootstrap первого admin: из env `ADMIN_USERNAME` / `ADMIN_PASSWORD` при пустой таблице users (Q8).

## 5. Audit

В `audit_logs` фиксируются как минимум:

- login success/failure
- logout (опционально)
- изменение settings
- replace SSH key
- SSH test
- manual poll
- registrations poll start/finish
- изменения пользователей/ролей

В meta — без секретов. SSH host/username/action/result — можно.

**Phase 6 UI:** `GET /api/audit` + `/audit` (permission `audit:read`). Meta проходит sanitization на запись и при чтении; секретоподобные ключи → `[REDACTED]`.

## 5.1 Request hardening (Phase 6)

Поверх Better Auth session cookies:

| Control | Scope |
|---------|--------|
| Same-origin (Origin/Referer) | Mutating app APIs: settings update/key replace, SSH test, manual poll |
| Login rate limit | Better Auth `sign-in/username` — 10 attempts / 5 min per IP (in-memory) |
| Poll rate limit | `POST /api/regs/poll` — 6 / min per user (in-memory; anti-overlap remains) |
| SSH test rate limit | `POST /api/settings/ssh/test` — 10 / min per user |
| Log redaction | JSON logger redacts password/key/token-like fields |

In-memory limiters assume **single** `app` replica (same as in-process scheduler). Multi-replica requires a shared store — out of v1 scope.

Jobs operator UI: `GET /api/jobs` + `/jobs` (`regs:read`) — no SSH secrets, no raw key material, no full artifact stdout dump in UI.

## 5.2 Production deployment assumptions (Phase 7)

| Rule | Detail |
|------|--------|
| Single `app` replica | Required for scheduler + in-memory rate limits |
| Auto-poll control | Settings `regsPollEnabled` only (no env gate) |
| Secrets at startup | Production rejects placeholder `BETTER_AUTH_SECRET` and example `APP_ENCRYPTION_KEY` |
| `BETTER_AUTH_URL` | Public browser origin (HTTPS behind NPM) |
| `APP_ENCRYPTION_KEY` | Must be backed up with DB dumps — see [backup-and-restore.md](./backup-and-restore.md) |
| Migrations | Compose `migrate` service runs `prisma migrate deploy` before `app` |
| Edge proxy | External NPM only; `/` and `/api` → same upstream |

Go-live: [production-checklist.md](./production-checklist.md). Smoke: [smoke-tests.md](./smoke-tests.md).

## 6. Запрещённые дизайны

- Прямой shell из UI
- Редактируемый remote command в Settings
- Хранение plaintext ключей
- Возврат расшифрованного ключа в API («показать ключ»)
- `invoke_shell` / PTY для исполнения
- Универсальный «run any script from /opt/scripts» picker без code review/release allowlist
- Произвольный `ssh.exec` строки от клиента
- Горизонтальный запуск poll на нескольких репликах без single-runner (v1: одна реплика `app`)

## 7. Remote server checklist (ops)

Документируется для DevOps — см. [remote-server-setup.md](./remote-server-setup.md):

1. Отдельный unix-пользователь для платформы.
2. Ключ только для платформы.
3. `authorized_keys` с `command=...`, **без** `no-pty` (скрипту нужен TTY), без forwarding.
4. Скрипты только в `/opt/scripts/`, минимальные права.
5. ACL или узкий sudoers.
6. Проверка: `ssh -i key user@host whoami` всё равно выполняет forced script и печатает CSV / ожидаемый результат.

См. также [open-questions.md](./open-questions.md).
