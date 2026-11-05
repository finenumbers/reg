# Data Model

PostgreSQL 16 + Prisma. Ниже — целевая схема v1 с разделением на **platform-core** и **registrations module**.

Auth: **Better Auth Prisma adapter / CLI — source of truth**.  
Не хардкодить кастомные имена auth-моделей в docs. В Phase 1: сгенерировать schema через официальный adapter/CLI, затем выровнять Prisma под этот контракт. App-specific поля добавлять только если совместимо с адаптером. Primary login = **username**. Кастомный JWT/refresh-token стек не используется.

## 1. ER overview

```text
[Better Auth generated models]
       ├── user_roles ── roles ── role_permissions ── permissions
       └── audit_logs (actor)

ssh_profiles
app_settings ── active_ssh_profile_id → ssh_profiles
allowed_actions   (seed/code-owned)
api_keys          (machine read-only; hash only)

job_runs ── job_run_artifacts
ssh_connection_tests

reg_current          (module)
reg_change_events    (module)
```

## 2. Platform-core entities

### Better Auth models (adapter-generated)

Имена таблиц/полей и relations — **только** из вывода Better Auth Prisma adapter/CLI.  
Не описывать здесь выдуманную auth-схему. После генерации в репозитории: `prisma/schema.prisma` (auth block) = контракт.

App-specific дополнения (если поддержаны адаптером), например soft-disable / RBAC linkage — отдельно, без ломки generated contract.

**Не используем:** отдельную таблицу `refresh_tokens` кастомного JWT-стека.

### roles / permissions / user_roles / role_permissions

Назначение: RBAC поверх Better Auth.

Роли seed: `admin`, `operator`.  
Permissions seed: `settings:write`, `ssh:test`, `regs:read`, `regs:poll`, `audit:read`, `users:admin`.

### ssh_profiles

Назначение: SSH credentials softswitch (v1 — один active profile).

| Column | Notes |
|--------|-------|
| id | uuid |
| name | display name |
| host | |
| port | default 22 |
| username | |
| private_key_ciphertext | text/bytea AES-GCM |
| key_fingerprint | sha256 |
| key_algo | e.g. ssh-rsa / ssh-ed25519 |
| created_at / updated_at | |

**Не храним:** plaintext key, original `.ppk`, passphrase после успешного normalize/import.

### app_settings

Назначение: singleton конфигурации приложения.

| Column | Notes |
|--------|-------|
| id | int PK = 1 |
| active_ssh_profile_id | FK nullable |
| regs_poll_enabled | boolean |
| regs_poll_interval_sec | int, настраивается в UI; технический min в валидации (рекомендуемо ≥ 30) |
| artifact_retention_days | int, настраивается в UI |
| artifact_keep_last_runs | int, настраивается в UI |
| artifact_max_bytes | int, лимит размера stdout/stderr на run |
| updated_at | |

### allowed_actions

Назначение: отражение code-owned allowlist в БД для аудита/UI labels.  
**remote_path не редактируется через API.**

| Column | Notes |
|--------|-------|
| code | PK, e.g. `regs.poll` |
| remote_path | Код действия (`regs.poll`, `phones.sync`, …). Задания выполняются локально. Через API колонка не редактируется |
| description | |
| enabled | boolean |
| module | `registrations` |

### job_runs

Назначение: история фоновых/ручных выполнений (platform-wide). Создаются job runtime на базе `p-queue`.

| Column | Notes |
|--------|-------|
| id | bigserial/uuid |
| action_code | FK/logic → allowed_actions.code |
| trigger | `schedule` \| `manual` \| `test` |
| status | `running` \| `success` \| `failed` |
| started_at / finished_at | |
| duration_ms | |
| error_message | safe text |
| exit_code | int nullable |
| phones_parsed / lines_bad / changes_count | module-usable counters (nullable/generic JSON ok) |
| actor_user_id | nullable (manual/test) |

**UI:** список запусков, диагностика.

### job_run_artifacts

Назначение: optional raw stdout/stderr; retention из `app_settings`.

| Column | Notes |
|--------|-------|
| job_run_id | PK/FK |
| stdout | text, truncated |
| stderr | text, truncated |

### ssh_connection_tests

Назначение: отдельные записи тестов соединения (можно как subset job_runs с trigger=`test`; допускается отдельная таблица для UX).

| Column | Notes |
|--------|-------|
| id | |
| profile_id | |
| actor_user_id | |
| result | success/auth_error/timeout/error |
| detail | safe |
| exit_code | |
| parsed_count | |
| created_at | |

### audit_logs

Назначение: админский/security audit.

| Column | Notes |
|--------|-------|
| id | |
| actor_user_id | nullable |
| action | e.g. `settings.update`, `ssh.key_replace` |
| entity_type / entity_id | |
| meta | jsonb без секретов |
| ip | |
| created_at | |

## 3. Registrations module entities

### reg_current (fast UI reads)

Текущее состояние каждого номера.

| Column | Notes |
|--------|-------|
| phone | varchar PK |
| status | `Registered` \| `Unregistered` |
| ip | nullable |
| port | nullable int |
| userAgent | nullable text, колонка `"userAgent"`; «Агент пользователя» живой регистрации |
| last_seen_at | последний успешный apply |
| last_changed_at | последнее изменение status/ip/port |
| last_job_run_id | FK job_runs |
| updated_at | |

Индексы: `(status)`, `(last_changed_at DESC)`.

### reg_change_events (history for detail card)

Пишется **только если** изменились status и/или ip и/или port.

| Column | Notes |
|--------|-------|
| id | bigserial |
| phone | indexed |
| old_status / new_status | old nullable on first see |
| old_ip / new_ip | |
| old_port / new_port | |
| changed_at | |
| job_run_id | |

Индекс: `(phone, changed_at DESC)`.

Full snapshot всех номеров на каждый run **не хранится**. Путь записи: `reg_current` + `reg_change_events` + `job_run_artifacts`.

## 4. Что для UI, что для history/audit

| Потребность | Таблица |
|-------------|--------|
| Таблица регистраций | `reg_current` |
| Карточка истории номера | `reg_change_events` |
| Индикатор последнего опроса | `job_runs` (+ app_settings) |
| Диагностика SSH | `ssh_connection_tests` / `job_runs` |
| Security/compliance | `audit_logs` |
| Сырой вывод задания | `job_run_artifacts` |
| Сессии логина | Better Auth `session` (+ `account`) |

## 5. Правила записи регистраций

На одном **успешном** poll — **full replace** комплекта `reg_current`:

1. Собрать строки страниц РТУ «Регистрации (ПКомм)» и «Регистрации (ПУпр)». Одинаковые живые строки одного номера схлопываются. Разные живые строки одного номера прогон не валят: остаётся более позднее «Время окончания регистрации»; равное или неразобранное время оставляет меньший id.
2. Для каждого phone из списка:
   - если нет в `reg_current` → insert + change_event (old=null);
   - если status, ip и port равны → обновить `last_seen_at` и `userAgent`, событие не писать и `last_changed_at` не двигать;
   - если status, ip или port отличаются → update current + insert change_event.
3. Удалить из `reg_current` любые phone, которых **нет** в списке (история `reg_change_events` сохраняется; событие на delete не пишем).
4. Пустая страница ПКомм при **непустой** `reg_current` → отказ от wipe, run = `failed`. Пустая таблица и пустая страница допустимы. Синтез «Не зарегистрирован» для каталога «Регистрация» = «Да» идёт только после непустой страницы.
5. При ошибке чтения, таймауте, неполной странице или несопоставленном имени → **не** менять `reg_current` и **не** писать change events; run = `failed`; `exitCode` пустой; UI показывает проблему.

### Phones / groups

Полный replace snapshot в одной транзакции. Пустой снимок телефонов при непустой таблице — отказ от wipe. Пустой список групп заменяет таблицу, в том числе очищает её. Неполный список оборудования, несовпадение со счётчиком, обрыв и таймаут до записи не доходят. Снимок без целой стороны, паролей, зон, протоколов, списков адресов или групп отклоняется. Успешный полный снимок телефонов заменяет каталог, включая номера, которых на странице больше нет.

### CDR (`cdr_records`)

- Успешный dump-файл → строки в БД, файл **удаляется** из FTP inbox.
- Строка без гражданской даты+времени (`Дата` / `cdr_day` + время) отклоняется так же, как пустой `cdr_id` или неверная ширина.
- Битые строки: валидные уже вставленные строки остаются (`skipDuplicates` по `cdr_id`); файл остаётся + poison; job = `failed`; баннер на CDR-страницах, полный список файлов на «Сырые данные».
- Poison **не** автоимпортируется. Leftover без poison подхватывает scheduler tick и хвост `cdr.import`.
- Во время `cdr.purge.month` строки целевого месяца не вставляются; файл остаётся с hold и после джобы drain повторяется.
- Индекс `(cdr_date, cdr_id)` — list/export/DELETE; индекс `cdr_day` — `GROUP BY` месяцев на `/settings` (хранение CDR) и в кэше dropdown.
- Секунды: `elapsed_time` — миллисекунды. Секунды = `CEIL(ms/1000)` на звонок. Минуты на `/settings` (хранение CDR), `/stats`, `/detail` и `/traffic` считаются по этим секундам: 0–3 секунды дают 0 минут, с 4-й секунды `CEIL(секунд/60)`, затем `SUM` (не сумма секунд месяца / 60). На `/traffic` те же минуты показываются по каждому звонку, без суммы; пустые секунды оставляют ячейку пустой. Стоимость тарифицируемого звонка равна этим минутам, умноженным на цену. `/detail` группирует по текущему `phone_endpoints.data.Описание` через `TRIM(bill_ani/bill_dnis) = TRIM(endpointNumber)`; новой таблицы нет.
- Тариф звонка (`tariff_direction`, `tariff_price`, `tariff_charge`) пишется той же функцией, что и на вставке. `tariff_price` — текст «Цены» из снимка тарификации (без округления до копейки); на экранах её нет. Пустая строка — звонок не тарифицируется; `0.00` — сумма вышла нулевой. Сумма — две цифры после запятой, округление вверх до копейки. После замены снимка тарифов весь журнал пересчитывается пачками; строка переписывается только если тройка изменилась.
- `enrichedAt` ставится только после завершённого PSTN/GeoIP lookup (включая cached not-found). Live-ошибка → `enrichedAt` null, backfill повторит.

### VoIPmonitor (`cdr_voipmonitor_links`)

Отдельная 1:1 проекция на `cdr_records`. URL пишется **только** после match (`matched_exact` / `matched_fallback`). `voipmonitor_legs` — JSON `{ in?, out? }` с отдельными `fcallid`-ссылками на входное и исходящее плечо Satel. Точный Call-ID: две строки Satel могут показать один Calltrace. Аксиома: загруженный CDR обычно есть в VoIPmonitor; пустая ячейка после успокоения очереди чаще дефект matcher, но после потолка попыток «не нашли» джоба не крутится (записи в VM может не быть). Job `voipmonitor.match` берёт час live, затем archive-часы до бюджета, ретраит miss с backoff. Ссылки не читаются из Collector.

### Enrich

Таблица `enrich_jobs` удалена в v1.183.0 вместе с экраном «Обогатить данные». Кэш PSTN, кэш GeoIP и колонки обогащения CDR остаются. Поставщик номера хранится в `phone_endpoints.data['Поставщик']` и переносится снимком `phones.sync`, пока текст номера не изменился.

## 6. Пример формата источника

Блок ниже — старый semicolon-дамп. Текущий источник регистраций — строки `selectRowset`.

```text
73852222205;Registered;46.20.69.189:5060
73912193303;Unregistered;
420910902600;Registered;185.175.158.149:5060
```

Пустой endpoint при `Unregistered` — норма.
