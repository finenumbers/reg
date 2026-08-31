# Architecture — SIP Registration Platform

Внутренняя ops-платформа телеком-оператора для безопасной работы со скриптами softswitch по SSH и хранения результатов в локальной БД.

Документ фиксирует архитектурные решения. Open questions закрыты — см. [open-questions.md](./open-questions.md).

**Утверждённые продуктовые решения:**
- sudo на softswitch разрешён узко (NOPASSWD sudoers); приложение шлёт константу `/usr/bin/sudo -n -- /opt/scripts/check_regs.sh` из кода allowlist (не из UI);
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
- in-process scheduler bootstrap: `instrumentation.ts` (always starts timer loops); `regs.poll` when `regsPollEnabled`; `phones.sync`/`groups.sync` when `exportSyncEnabled` (one `export.py` at a time); `cdr.sides.refresh` when `cdrSidesRefreshEnabled`; single `app` replica assumed (no leader election in v1).

## 1. Цель системы

Платформа:

1. Подключается к внешнему Debian softswitch **только по SSH**.
2. Запускает **только заранее разрешённые** скрипты из `/opt/scripts/`.
3. Парсит stdout, сохраняет данные в PostgreSQL.
4. Показывает операторам UI на основе **локальной БД** (не live-SSH для таблиц).

Первый продуктовый модуль — **мониторинг SIP-регистраций** (`check_regs.sh`). Второй — **телефонные номера / шлюзы** (`export.py`). Архитектура рассчитана на дополнительные модули вокруг других скриптов.

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
| Action | `regs.poll` → `/usr/bin/sudo -n -- /opt/scripts/check_regs.sh` (path `/opt/scripts/check_regs.sh`, argv пустой) |
| Parser | Строки `phone;Registered\|Unregistered;ip:port\|` |
| Storage | `reg_current`, `reg_change_events` |
| API | Route Handlers: список, поиск, карточка истории, manual poll |
| UI | Таблица + detail sheet |
| Job processor | Обработчик очереди `p-queue` именно для `regs.poll` |

### Module: Phones

| Область | Ответственность |
|---------|-----------------|
| Action | `phones.sync` → allowlisted `export.py` на softswitch |
| Storage | `phone_endpoints`, `phone_gateways` (полный replace snapshot) |
| API | list/facets/status/request; XLSX export; RTU CSV convert; UFW XLSX export |
| UI | `/phones` — фильтры, экспорт, импорт в РТУ/UFW |

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
| Job orchestration | `p-queue` (in-process; concurrency=1 для `regs.poll`); bootstrap eval via `instrumentation.ts` |
| Auth | Better Auth (username + password, session cookies); RBAC поверх |
| RBAC | Роли `admin` / `operator` + permissions |
| SSH client | `ssh2` (Node), только `exec` разрешённой команды |
| Secrets at rest | AES-256-GCM, master key `APP_ENCRYPTION_KEY` из env |
| Deploy | Docker Compose / Portainer: `db` → `migrate` → single `app` |
| Edge proxy | Внешний NGINX Proxy Manager (уже есть) — **не дублировать** в compose |

Compose-сервисы v1: `db` (PostgreSQL) → `migrate` (`prisma migrate deploy`) → `app` (Next.js, одна реплика), сеть `proxy` для NPM.  
Redis **не** входит в v1 (BullMQ не используется). Отдельный worker-контейнер в v1 не обязателен: poll-цикл и manual jobs идут в процессе `app` через `p-queue` + timer/interval, синхронизированный с `app_settings`.

> Примечание: in-process scheduler означает, что при горизонтальном масштабировании нескольких реплик `app` нужен механизм лидерства / single-runner. В v1 предполагается **одна** реплика `app` за NPM.

## 4. Высокоуровневая схема

```text
Browser
  → NGINX Proxy Manager (external)
    → app  (Next.js: UI + /api Route Handlers)
         ↘ PostgreSQL
         ↘ p-queue scheduler / job runners (in-process)
              → SSH Executor (allowlist only)
                   → Debian softswitch
                        → /usr/bin/sudo -n -- /opt/scripts/check_regs.sh
                        → (optional) /opt/scripts/platform_exec.sh  (forced command)
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
3. Читает settings + SSH profile.
4. Создаёт `job_runs` со статусом `running`.
5. Расшифровывает ключ в памяти → SSH connect → exec allowlisted path (`cd /opt/scripts && sudo -n -- ./<script>`; PTY только для `regs.poll`).
6. Парсит stdout. Любая битая строка (`linesBad > 0`) **валит весь прогон** (fail-closed): `reg_current` не меняется.
7. Обновляет `reg_current`; пишет `reg_change_events` **только при изменении** status/ip/port. Пустой dump при непустой таблице — отказ от wipe.
8. UI читает API из локальной БД. Scheduler tick также сканирует FTP inbox и ставит `cdr.import` на leftover-файлы (не poison).

Политика при ошибке/`exitCode != 0`/пустом stdout: run = failed, current state **не** трогать, на сайте явный сигнал о проблеме.

## 7. API surface (внутренний)

Группы маршрутов (Next.js Route Handlers):

- `/api/auth/*` — Better Auth handler
- `/api/settings/*` (+ SSH test / key replace)
- `/api/regs/*`
- `/api/jobs/*`
- `/api/audit/*`
- `/api/storage`, `/api/storage/purge` — admin CDR month inventory / oldest-complete-month delete
- `/api/stats` — monthly CDR summary: ТфОП / LDC / Trunk_ / platforms (`phones:read`)
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
