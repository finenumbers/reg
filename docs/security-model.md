# Security Model

Номера, группы, регистрации и текущие звонки читает API РТУ. SSH к коммутатору открывается только для проверки входа и команду не шлёт. Журнал парковки читается отдельным ключом на другом хосте.

Бизнес- и SSH-ограничения ниже **не зависят** от смены стека (Next.js / Better Auth / p-queue). Меняется только способ AuthN на стороне приложения.

## 1. Threat model (кратко)

| Угроза | Контрмера |
|--------|-----------|
| Произвольная команда с UI/API | Нет полей command, scriptPath, remoteArgs. Задания РТУ — локальные коды |
| Команда на коммутатор | Приложение её не собирает и не отправляет |
| Злоупотребление sudo на коммутаторе | Приложение sudo не отправляет |
| Утечка private key | AES-256-GCM at rest; decrypt только in-memory; не логировать; UI mask; нет export |
| Подмена ключа/настроек | RBAC; audit log |
| CSRF | Session cookies Better Auth (httpOnly, Secure, SameSite) + проверка Origin/CSRF на mutating requests |

## 2. Локальные задания и SSH к коммутатору

В коде платформы (и в seed БД, синхронизированном с кодом) есть реестр заданий:

| action code | Что делает |
|-------------|------------|
| `regs.poll` | Чтение «Регистрации (ПКомм)» и «Регистрации (ПУпр)» |
| `phones.sync` | Чтение страницы «Оборудование» |
| `groups.sync` | Чтение страницы «Входящие группы» |
| `cdr.import` | Разбор локальной папки FTP |
| `cdr.sides.refresh` | Сверка Описаний каталога с `cdr_records.side_*` |
| `cdr.purge.month` | Пакетное удаление самого старого полного месяца CDR |

`phones.sync` читает страницу РТУ «Оборудование» и заменяет `phone_endpoints` и `phone_gateways`. Пароли регистраций в таблице phones по-прежнему хранятся и показываются открытым текстом (доступ через RBAC `phones:read`). Конверт и тело ответа в артефакты задания не пишутся. `groups.sync` читает страницу РТУ «Входящие группы» и заменяет только `routing_groups`.

Клиент не передаёт команду. SSH-профиль коммутатора используется кнопкой проверки сессии: после входа канал с командой не открывается.

### Parking RADIUS

### Parking RADIUS

`parking.finenumbers.com` не меняется. Отдельного пользователя и forced command там нет: сервер править нельзя, а доступный ключ — интерактивный admin с `NOPASSWD: ALL`. Компенсация в приложении:

- секрет ключа лежит отдельно от `activeSshProfileId` и не подставляется в allowlist софтсвитча;
- адрес, имя пользователя и путь к логу задаются в настройках; порт 22 и отпечаток хоста — константы;
- по SSH уходят только `stat` и `dd` уже проверенного пути, offset — десятичные цифры;
- host key проверяется по закреплённому SHA256 до входа;
- UI не задаёт команду.

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
- Команду не отправляет и `reg_current` не обновляет.
- Пишет результат в `ssh_connection_tests` + audit `ssh.test`.

### RTU SOAP

- Настройки хранят HTTPS origin, логин и пароль веб-интерфейса РТУ. Пароль — AES-256-GCM ciphertext, в API только `hasRtuSoapPassword`.
- `POST /api/settings/rtu/test` — одна читающая операция `getObjects` (таблицы и процедуры). Конверт с паролем уходит только на host из origin. Запись и `call` клиент собрать не может.
- `GET /api/live-calls` — сессия с `phones:read`. API-ключ маршрут не открывает. Сервер читает `describeTable` и `selectRowset` только у «Транзитные вызовы (ПКомм)» и «Транзитные вызовы (ПУпр)». Имена таблиц с клиента не принимаются. Удаление вызова не отправляется. Пока раздел открыт, снимок обновляется не чаще одного раза в 3 секунды на процесс.
- `groups.sync` читает `describeTable` и `selectRowset` только у страницы «Входящие группы» в папке «Оборудование». Заголовок `node` и `getLookup` не отправляются. Успешный список целиком заменяет `routing_groups`. Конверт и тело ответа в артефакты задания не пишутся.
- `phones.sync` читает `describeTable` и `selectRowset` только у страницы «Оборудование» в папке «Оборудование», до 25 страниц. Заголовка `node` нет. `getLookup` только для «Тип оборудования», «Протокол сигнализации» и «Входящие группы», когда `describeTable` ставит `have_lookup`. `countRowset` — один раз, с пустым фильтром, если операция есть в WSDL v2. Успешное чтение заменяет `phone_endpoints` и `phone_gateways`. Пустая страница непустой каталог не стирает. Конверт и тело ответа в артефакты не пишутся.
- `regs.poll` читает `describeTable` и `selectRowset` у «Регистрации (ПКомм)» и «Регистрации (ПУпр)». Сводная страница идёт без `node`. Если её нет, общий шаблон «Регистрации» читается с `node` только для `signaling-<цифры>` на ПКомм и `scripting-<цифры>` на ПУпр, не больше четырёх, после страницы «Активные модули». `getLookup` уходит только для «Состояние» на ПКомм, когда `describeTable` ставит `have_lookup`. `getColumnLookup` уходит, только если эта операция есть в полученном WSDL v2. Если обеих нет, один `getLookup` идёт в стиле уже принятого `describeTable`. Отсутствующий или непрочитанный список задание не валит. Неузнанная ячейка валит задание и не меняет `reg_current`. «Время окончания регистрации» добавляется в тот же `selectRowset` ПКомм, только если заголовок встретился один раз и техническое имя допустимо. Для неё `getLookup` не вызывается, а отсутствие колонки чтение не валит. Несколько живых регистраций одного номера оставляют более позднее окончание; равное или неразобранное время оставляет меньший ID. Время в таблицу не пишется. Успешный непустой список заменяет `reg_current`. Пустая страница непустую таблицу не стирает. Конверт и тело ответа в артефакты не пишутся.
- Сессия `settings:write`. API-ключи маршрут не открывают. 5 проверок на пользователя за 10 минут и один выполняющийся тест на процесс.
- Аудит `rtu.soap.test`: origin, логин, код, два счётчика. Список объектов и SOAP-тело не пишутся.
- Сертификат коммутатора можно вставить в Настройках как PEM. Он доверяется проверке доступа и чтению текущих вызовов и не становится корнем процесса. Совпадение отпечатка листа разрешает адрес по IP; чужой лист того же CA — нет. Проверка подписи и срока не отключается. `NODE_EXTRA_CA_CERTS` по-прежнему добавляет корень всему процессу. SSH allowlist не расширяется.

### Задания РТУ

- `phones.sync` — локальное чтение API РТУ. Ручного `POST /api/phones/request` нет. Право `phones:request` в сиде остаётся: им пользуются поставщики, география, повтор трафика и SMG.
- Клиент/API **не** передаёт `command` / `scriptPath` / `remoteArgs`.
- `regs.poll` — локальное чтение API РТУ. Ручного `POST /api/regs/poll` нет. Право `regs:poll` в сиде остаётся и в интерфейсе не создаёт кнопку.
- Auto-scheduler: in-process loop always starts at boot; ticks enqueue only when Settings `regsPollEnabled=true` (interval from `regsPollIntervalSec`, min 30s). Первый тик после старта процесса — около пяти секунд. Single `app` replica required.

## 4. AuthN / AuthZ

**Утверждено (Q2 + Q11):** только локальные пользователи через **Better Auth** (password plugin / email-or-username). SSO/LDAP не в v1.

- Пароли: хеширование через Better Auth (не хранить plaintext).
- Сессия: cookie-based session Better Auth (httpOnly, Secure в prod, SameSite); модели `session` / `account` / `verification` в БД по схеме Better Auth + Prisma adapter.
- **Machine API keys (v1.3):** read-only интеграции через `Authorization: Bearer <key>` или `X-Api-Key`. Секрет хранится только как SHA-256 hash (`api_keys`). Права по умолчанию: `regs:read` + `phones:read`. Rate limit **10 000 / мин на ключ** (in-memory, single replica). Создание/отзыв — Settings (`settings:write`). Ключи **не** открывают poll/sync/settings/SSH, RTU import (`POST /api/phones/rtu-import`) и тарификацию (`GET /api/tariffs`, `POST /api/tariffs/import`): каталог тарифов доступен только из сессии с `phones:read`.
- Кастомный JWT access/refresh стек и отдельная таблица `refresh_tokens` **не** используются.
- RBAC поверх Better Auth (роли/permissions в собственных таблицах, привязка к user id):
  - `admin` — settings, ключи, users, audit
  - `operator` — просмотр регистраций (без смены SSH-ключей и без ручного опроса)
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
| Same-origin (Origin/Referer) | Mutating app APIs: settings update/key replace, SSH test, CDR month purge |
| Login rate limit | Better Auth `sign-in/username` — 10 attempts / 5 min per IP (in-memory) |
| Registrations poll | scheduled `regs.poll` only; anti-overlap is per action code |
| SSH test rate limit | `POST /api/settings/ssh/test` — 10 / min per user |
| RTU SOAP test rate limit | `POST /api/settings/rtu/test` — 5 / 10 min per session user; one in-flight check per process; API keys cannot call it |
| Storage purge rate limit | `POST /api/storage/purge` — 3 / min per session user; session + `settings:write` only (API keys cannot purge) |
| API key rate limit | Machine key reads — 10 000 / min per key (in-memory) |
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
| Migrations | Compose `migrate` service runs `prisma migrate deploy` and the CDR category backfill before `app` |
| Edge proxy | External NPM only; `/` and `/api` → same upstream |

Go-live: [production-checklist.md](./production-checklist.md). Smoke: [smoke-tests.md](./smoke-tests.md).

## 6. Запрещённые дизайны

- Прямой shell из UI
- Редактируемый remote command в Settings
- Хранение plaintext ключей
- Возврат расшифрованного ключа в API («показать ключ»)
- Запуск команды на коммутаторе из приложения
- Произвольный `ssh.exec` строки от клиента
- Горизонтальный запуск poll на нескольких репликах без single-runner (v1: одна реплика `app`)

## 7. SSH к коммутатору

Кнопка в Настройках проверяет только вход. Приложение не требует forced command и sudoers на коммутаторе. Журнал парковки описан выше.

См. также [open-questions.md](./open-questions.md).
