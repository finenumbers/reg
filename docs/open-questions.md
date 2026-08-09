# Open Questions — решения

Все вопросы закрыты, включая выбор стека (Q11). Исторические решения ниже сохранены для контекста; приложение уже в production.

---

## Q1. Привилегии `check_regs.sh` — DECIDED

**Решение:** разрешаем использование **sudo** для запуска скриптов платформы.

На softswitch: узкий `sudoers` NOPASSWD на `/opt/scripts/check_regs.sh`.  
Приложение **отправляет** константу `/usr/bin/sudo -n -- /opt/scripts/check_regs.sh` из кода allowlist (`elevateWithSudo`), **не** из UI. Опциональный forced wrapper принимает path или эту же sudo-строку и всегда elevates через `sudo -n`.

- Status: `DECIDED`
- Answer: sudo разрешён (контролируемо: app constant `sudo -n` + NOPASSWD sudoers; no UI-built sudo)

---

## Q2. Аутентификация — DECIDED

**Решение:** только локальные пользователи. SSO/LDAP не в v1.

Реализация AuthN: **Better Auth** (password + session cookies) + RBAC поверх (роли/permissions).  
Ранее рассматривавшийся кастомный Argon2 + JWT access/refresh стек **снят** в пользу Better Auth (см. Q11).

- Status: `DECIDED`
- Answer: local auth via Better Auth + RBAC

---

## Q3. Число softswitch — DECIDED

**Решение:** один сервер / один active SSH profile в v1.

- Status: `DECIDED`

---

## Q4. Retention сырого stdout/stderr — DECIDED

**Решение:** настраивается **в Настройках на сайте** (не только hardcode в коде).

В `app_settings` хранить параметры retention (например: срок в днях и/или лимит числа runs, лимит размера артефакта). Cleanup job / scheduled task в процессе `app` применяет политику.

- Status: `DECIDED`

---

## Q5. Интервал автоопроса — DECIDED

**Решение:** настраивается **в Настройках на сайте** (enabled + interval).

Технический минимум в коде/валидации остаётся защитой softswitch (рекомендуемый floor: 30 секунд), значение по умолчанию и рабочий интервал — из Settings UI.

- Status: `DECIDED`

---

## Q6. Partial output при ошибке — DECIDED

**Решение:** **ничего не сохранять** в `reg_current` / `reg_change_events` при неуспешном прогоне.  
На сайте **явно сигнализировать** о проблеме (статус последнего цикла, ошибка, stderr preview / сообщение).

- Status: `DECIDED`

---

## Q7. Forced command / wrapper — DECIDED

**Решение: B** — сразу общая обёртка `/opt/scripts/platform_exec.sh` под будущие скрипты.

Ключ платформы в `authorized_keys` с forced command на wrapper; wrapper держит локальный allowlist путей только в `/opt/scripts/`.

- Status: `DECIDED`

---

## Q8. Bootstrap админа — DECIDED

**Решение:** да, из env `ADMIN_USERNAME` / `ADMIN_PASSWORD` при пустой таблице users.

- Status: `DECIDED`

---

## Q9. Публикация через NPM — DECIDED

**Решение:** через уже существующий внешний NGINX Proxy Manager, сеть `proxy`.  
Внутри compose своего edge reverse proxy нет. Один сервис `app` (Next.js) принимает `/` и `/api`.

- Status: `DECIDED`

---

## Q10. Export SSH-ключа — DECIDED

**Решение:** нет. Только replace. API не отдаёт plaintext/ciphertext ключа клиенту.

- Status: `DECIDED`

---

## Q11. Application stack — DECIDED

**Контекст:** ранее в docs был зафиксирован NestJS + React/Vite/Mantine + Redis/BullMQ + кастомный JWT. Brief утвердил другой стек. Docs выровнены под brief; NestJS/BullMQ/Vite **не сохраняются**.

**Решение:**

| Слой | Выбор |
|------|--------|
| App | Next.js App Router (UI + Route Handlers) |
| Language | TypeScript |
| DB | PostgreSQL + Prisma |
| Auth | Better Auth (local password + sessions) + RBAC |
| SSH | `ssh2` |
| Jobs | `p-queue` in-process (v1: одна реплика `app`) |
| UI kit | shadcn/ui + Tailwind CSS |
| Tables UI | Custom tables + column filters *(historical Q11 mention of TanStack Table was not shipped)* |
| Deploy | Docker Compose; внешний reverse proxy вне проекта |

**Не в стеке v1:** NestJS, отдельный React+Vite frontend, Redis, BullMQ, кастомный JWT refresh stack, внутренний edge proxy, `@tanstack/react-table`.

- Status: `DECIDED`
- Answer: Next.js + Prisma + Better Auth + ssh2 + p-queue + shadcn/ui + custom tables + Compose
- Note: tables shipped as custom UI + column filters (no `@tanstack/react-table` dependency)

---

## Q12. Login identifier, UI kit, auth schema source, scheduler bootstrap — DECIDED

| Тема | Решение |
|------|---------|
| Primary login | **username** (Better Auth username plugin) |
| UI kit | **shadcn/ui + Tailwind CSS**; таблицы — custom tables + column filters |
| Better Auth Prisma models | **adapter/CLI-generated source of truth**; не изобретать кастомную auth-схему до generate; app fields только поверх, если совместимо |
| Scheduler startup | implementation detail Phase 1; preferred first option = `instrumentation.ts`; реальный poll не стартует до safe execution layer + settings gating + single-instance + poll locking; если `instrumentation.ts` не подойдёт — явно задокументировать альтернативу |

- Status: `DECIDED`
