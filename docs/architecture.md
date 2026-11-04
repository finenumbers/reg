# Architecture — SIP Registration Platform

Внутренняя ops-платформа телеком-оператора для безопасной работы со скриптами softswitch по SSH и хранения результатов в локальной БД.

Документ фиксирует архитектурные решения. Open questions закрыты — см. [open-questions.md](./open-questions.md).

**Утверждённые продуктовые решения:**
- sudo на softswitch разрешён узко (NOPASSWD sudoers) для `phones.sync` (`export.py`); регистрации читает API РТУ, не SSH;
- сразу общая обёртка `/opt/scripts/platform_exec.sh` (рекомендуется);
- local auth only (Better Auth); один SSH profile;
- интервал опроса и retention артефактов — в Настройках UI;
- при ошибке опроса regs не обновлять, на сайте показать проблему;
- admin bootstrap из env; деплой за внешним NPM (сеть `proxy`);
- SSH-ключ: только replace, без просмотра/скачивания.

**Утверждённый стек (Q11):** Next.js App Router + TypeScript + PostgreSQL + Prisma + Better Auth + ssh2 + p-queue + shadcn/ui + Tailwind CSS + Docker Compose. Внешний reverse proxy вне проекта. NestJS / React-Vite / Redis-BullMQ **не используются**. *(Таблицы реализованы как custom UI + column filters, не TanStack Table.)*

**Утверждённые UI/Auth детали (Q12):**
- primary login identifier = **username** (Better Auth username plugin);
- UI kit = **shadcn/ui + Tailwind CSS**; таблицы данных = custom tables + column filters;
- Prisma-модели Better Auth = **adapter/CLI-generated source of truth** (не изобретать кастомную auth-схему до генерации);
- in-process scheduler bootstrap: `instrumentation.ts` (always starts timer loops); `regs.poll` when `regsPollEnabled`; `phones.sync`/`groups.sync` when `exportSyncEnabled` (phones run `export.py`, groups read the RTU API, one turn at a time); `cdr.sides.refresh` when `cdrSidesRefreshEnabled`; single `app` replica assumed (no leader election in v1).

## 1. Цель системы

Платформа:

1. Подключается к внешнему Debian softswitch **только по SSH**.
2. Запускает **только заранее разрешённые** скрипты из `/opt/scripts/`.
3. Парсит stdout, сохраняет данные в PostgreSQL.
4. Показывает операторам UI на основе **локальной БД** (не live-SSH для таблиц).

Первый продуктовый модуль — **мониторинг SIP-регистраций** (страницы РТУ «Регистрации (ПКомм)» и «Регистрации (ПУпр)»). Второй — **телефонные номера / шлюзы** (`export.py`). Архитектура рассчитана на дополнительные модули вокруг других скриптов.

Руководства SATEL по РТУ МТТ лежат только на машине разработчика в `docs/vendor/rtu-mtt/`. Каталог исключён из git и из Docker-контекста, поэтому в публичный репозиторий и в образ они не входят. Справочник API в комплекте описывает продукт 2.0, остальные файлы — 2.2.0. Номера и CDR по-прежнему идут по SSH allowlist и файлам. SOAP не входит в SSH. Проверка доступа в Настройках читает `getObjects` один раз. «Текущие звонки» дополнительно читает `describeTable` и `selectRowset` у двух таблиц транзитных вызовов (сводные страницы или общие шаблоны модулей). Если у «Состояние вызова» стоит `have_lookup`, та же страница читает `getLookup` для этой колонки. Собранные строки показываются по «Времени начала», поздние сверху; пустая и неразобранная метка остаётся внизу. Подпись снимка в UTC. Сортировка запроса остаётся пустой. PEM сертификата коммутатора из настроек доверяется этим чтениям. «Входящие группы» читает `describeTable` и `selectRowset` у страницы «Входящие группы» в папке «Оборудование», без заголовка `node` и без `getLookup`. «Регистрации» читает те же две операции у сводных страниц «Регистрации (ПКомм)» и «Регистрации (ПУпр)». Если сводной страницы нет, читается общий шаблон «Регистрации»: `node` только для `signaling-<цифры>` на ПКомм и `scripting-<цифры>` на ПУпр, не больше четырёх, после «Активные модули». `getLookup` только для «Состояние» на ПКомм, когда колонка помечена `have_lookup`. `getColumnLookup` уходит, только если эта операция есть в полученном WSDL v2. Если обеих нет, один `getLookup` идёт в стиле уже принятого `describeTable`. Отсутствующий или непрочитанный список чтение не валит. Неузнанная ячейка валит задание. «Время окончания регистрации» добавляется в тот же `selectRowset` ПКомм, только если заголовок встретился один раз и техническое имя допустимо. Для неё `getLookup` не вызывается, а отсутствие колонки чтение не валит. Несколько живых регистраций одного номера оставляют более позднее окончание; равное или неразобранное время оставляет меньший ID. Время в таблицу не пишется. Запись на коммутатор возможна только если отдельная задача называет операцию.

## 2. Разделение Platform Core и Module

### Platform Core (переиспользуемое ядро)

| Область | Ответственность |
|---------|-----------------|
| Auth / RBAC | Better Auth (локальные пользователи, сессии), роли, permissions |
| Settings | Глобальные настройки приложения |
| SSH profiles | Host/port/user, импорт ключей (.ppk/PEM), шифрование секретов |
| Actions allowlist | Реестр `actionId → абсолютный путь /opt/scripts/...` |
| Job runtime | In-process orchestration через `p-queue`, anti-overlap, статусы запусков |
| Audit | Журнал админ-действий и security-событий |
| Health / logging | `/api/healthz`, `/api/readyz`, JSON-логи |
| Admin shell UI | App Router layout, навигация, route guards |

Core **не знает** бизнес-семантику регистраций (парсер CSV, история номеров).

### First module: Registrations

| Область | Ответственность |
|---------|-----------------|
| Action | `regs.poll` — локальное чтение API РТУ, без SSH |
| Parser | Страницы «Регистрации (ПКомм)» и «Регистрации (ПУпр)»; парсер `check_regs.sh` в дереве остаётся и в задание не входит |
| Storage | `reg_current` (включая `userAgent`), `reg_change_events` |
| API | Route Handlers: список, поиск, карточка истории, статус опроса |
| UI | Таблица + detail sheet |
| Job processor | Обработчик очереди `p-queue` именно для `regs.poll` |

### Module: Phones

| Область | Ответственность |
|---------|-----------------|
| Action | `phones.sync` → allowlisted `export.py` на softswitch |
| Storage | `phone_endpoints`, `phone_gateways` (полный replace snapshot) |
| API | list/facets/status/request; XLSX export; RTU CSV convert; UFW XLSX export |
| UI | `/phones` — фильтры, экспорт, импорт в РТУ/UFW |

### Module: Incoming groups

| Область | Ответственность |
|---------|-----------------|
| Action | `groups.sync` — локальное чтение API РТУ, без SSH |
| Storage | `routing_groups` (полный replace текущего списка ID и «Название») |
| API | `GET /api/groups` |
| UI | `/groups` — таблица без ручной загрузки |

Будущий модуль = новый `action` + parser + таблицы/API/UI + processor. Ядро не переписывается.

## 3. Зафиксированный стек

| Слой | Решение |
|------|---------|
| Language | TypeScript end-to-end |
| App | Next.js (App Router) — UI + Route Handlers в одном приложении |
| UI kit | shadcn/ui + Tailwind CSS |
| UI tables | Custom tables + column filters (shadcn Table) |
| Database | PostgreSQL 16 |
| ORM | Prisma |
| Job orchestration | `p-queue` (in-process; concurrency=3, anti-overlap на action code); bootstrap eval via `instrumentation.ts` |
| Auth | Better Auth (username + password, session cookies); RBAC поверх |
| RBAC | Роли `admin` / `operator` + permissions |
| SSH client | `ssh2` (Node), только `exec` разрешённой команды |
| Secrets at rest | AES-256-GCM, master key `APP_ENCRYPTION_KEY` из env |
| Deploy | Docker Compose / Portainer: `db` → `migrate` → single `app` |
| Edge proxy | Внешний NGINX Proxy Manager (уже есть) — **не дублировать** в compose |

Compose-сервисы v1: `db` (PostgreSQL) → `migrate` (`prisma migrate deploy`, затем backfill категории CDR) → `app` (Next.js, одна реплика), сеть `proxy` для NPM.  
Redis **не** входит в v1 (BullMQ не используется). Отдельный worker-контейнер в v1 не обязателен: poll-цикл и manual jobs идут в процессе `app` через `p-queue` + timer/interval, синхронизированный с `app_settings`.

> Примечание: in-process scheduler означает, что при горизонтальном масштабировании нескольких реплик `app` нужен механизм лидерства / single-runner. В v1 предполагается **одна** реплика `app` за NPM.

## 4. Высокоуровневая схема

```text
Browser
  → NGINX Proxy Manager (external)
    → app  (Next.js: UI + /api Route Handlers)
         ↘ PostgreSQL
         ↘ p-queue scheduler / job runners (in-process)
              → SSH Executor (allowlist only) → phones `export.py`
              → RTU SOAP (read only) → registrations, groups, live calls
                   → Debian softswitch
```

## 5. Рекомендуемая структура репозитория

```text
Reg/
  src/                         # Next.js App Router application
    app/                       # routes: (auth), (admin), api/*
    components/                # UI shell, shared components
    modules/                   # domain boundaries
      auth/
      users/
      settings/
      ssh/
      actions/                 # allowlist + execution abstraction
      jobs/                    # p-queue orchestration
      registrations/           # first product module
      audit/
      health/
    lib/                       # prisma, crypto, logging, env
  prisma/
    schema.prisma
    seed.ts
  docs/
    architecture.md
    security-model.md
    data-model.md
    implementation-plan.md
    open-questions.md
  docker-compose.yml
  Dockerfile
  .env.example
  package.json
  README.md
```

Модуль регистраций живёт как feature-area `src/modules/registrations`, а не как отдельный микросервис в v1. Shared типы/константы action codes — в `src/modules/actions` и/или `src/lib`.

## 6. Поток данных модуля Registrations

1. Scheduler (interval из `app_settings`, если polling enabled) ставит задачу `regs.poll` в `p-queue`.
2. Очередь `p-queue` (concurrency=3) с anti-overlap **на action code**: второй `regs.poll` не стартует, пока первый in-flight (`phones.sync` / `groups.sync` / `cdr.import` могут идти параллельно). `cdr.purge.month` не стартует, пока `cdr.import` in-flight.
3. Создаёт `job_runs` со статусом `running`.
4. Читает учётку API РТУ и страницы «Регистрации (ПКомм)» и «Регистрации (ПУпр)». Конверт не пишется в артефакты.
5. Несопоставленное имя, неузнанное состояние, страницы без общего ID, обрыв, таймаут или неполная страница **валят весь прогон**: `reg_current` не меняется.
6. Успешный непустой список заменяет `reg_current`. Смена только «Агента пользователя» пишется в `userAgent` и не двигает `last_changed_at`. Событие пишется при новом номере и при смене status/ip/port. Пустая страница при непустой таблице — отказ от wipe.
7. UI читает API из локальной БД. Scheduler tick также сканирует FTP inbox и ставит `cdr.import` на leftover-файлы (не poison).

Политика при ошибке чтения: run = failed, `exitCode` пустой, current state **не** трогать, на сайте явный сигнал о проблеме.

## 7. API surface (внутренний)

Группы маршрутов (Next.js Route Handlers):

- `/api/auth/*` — Better Auth handler
- `/api/settings/*` (+ SSH test / key replace)
- `/api/regs/*`
- `/api/jobs/*`
- `/api/audit/*`
- `/api/storage`, `/api/storage/purge` — admin CDR month inventory / oldest-complete-month delete
- `/api/stats` — monthly CDR summary: ТфОП (Local+LDC joined, two-level header including Межгород) / Trunk_ (same header without Межгород) / platforms; parking + phantom on ТфОП and Trunk_ (`phones:read`)
- `/api/detail` — monthly client slices from the phones catalog (Описание + endpoint numbers) × incoming / PSTN Local / parking / Trunk_ / PSTN LDC+OLD (`phones:read`)
- `/api/dashboard` — home snapshot for a signed-in user (session only; not API keys). Routing groups stay an alert, not a card
- `/api/dashboard/calls` — today's chart and the rolling last two hours (session only; hidden without `phones:read`). Query `series` selects phone, client, phantom, parking-in, parking-out, or errors. Errors count category «Ошибка» per minute; the others are concurrent calls. An unknown series does not read CDR.
- `/api/healthz`, `/api/readyz`

Ни один endpoint не принимает поля `command`, `scriptPath`, `remoteArgs` из клиента.

Подробности endpoint’ов — в [implementation-plan.md](./implementation-plan.md).  
Модель безопасности — в [security-model.md](./security-model.md).  
Схема БД — в [data-model.md](./data-model.md).

## 8. Расширяемость

Чтобы добавить новый раздел:

1. Зарегистрировать новый `allowed_action` в коде/seed (path только `/opt/scripts/...`).
2. Добавить processor в job runtime (`p-queue`).
3. Добавить module-specific таблицы/миграции при необходимости.
4. Добавить API Route Handlers + UI section + пункт навигации.
5. Обновить remote allowlist/forced-command/wrapper на softswitch.

Запрещено: «универсальная форма запуска произвольного скрипта из UI».

## 9. Связанные документы

- [security-model.md](./security-model.md)
- [data-model.md](./data-model.md)
- [implementation-plan.md](./implementation-plan.md)
- [open-questions.md](./open-questions.md)
