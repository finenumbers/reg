/**
 * Presentation helpers for Audit UI — pure, testable, no React.
 * Avoid importing Prisma-backed modules so unit tests stay DB-free.
 */

import { formatDisplayTimestamp } from "@/lib/format-display-time";

export type AuditLogDisplayItem = {
  action: string;
  actorUserId: string | null;
  actorUsername: string | null;
  entityType: string | null;
  entityId: string | null;
  meta?: Record<string, unknown> | null;
};

const ACTION_LABELS: Record<string, string> = {
  "auth.login_success": "Успешный вход",
  "auth.login_failure": "Неудачный вход",
  "auth.logout": "Выход",
  "users.admin_bootstrap": "Создание админа",
  "users.role_assign": "Назначение роли",
  "settings.update": "Изменение настроек",
  "ssh.key_replace": "Замена SSH-ключа",
  "ssh.test": "Тест SSH-соединения",
  "geoip.key_replace": "Замена ключа GeoIP",
  "geoip.test": "Тест GeoIP",
  "pstn.key_replace": "Замена ключа PSTN",
  "pstn.test": "Тест PSTN",
  "ftp.password_replace": "Замена пароля FTP",
  "ftp.test": "Тест FTP-слушателя",
  "enrich.start": "Старт обогащения данных",
  "enrich.finish": "Завершение обогащения данных",
  "regs.poll_manual": "Ручной опрос регистраций",
  "regs.poll_start": "Старт опроса регистраций",
  "regs.poll_finish": "Завершение опроса регистраций",
  "phones.sync_manual": "Ручная синхронизация телефонов",
  "phones.sync_start": "Старт синхронизации телефонов",
  "phones.sync_finish": "Завершение синхронизации телефонов",
  "groups.sync_manual": "Ручная загрузка входящих групп",
  "groups.sync_start": "Старт загрузки входящих групп",
  "groups.sync_finish": "Завершение загрузки входящих групп",
  "cdr.import_manual": "Ручной импорт телефонного трафика",
  "cdr.import_start": "Старт импорта телефонного трафика",
  "cdr.import_finish": "Завершение импорта телефонного трафика",
  "cdr.sides.refresh_manual": "Ручное обновление описаний в журнале звонков",
  "cdr.sides.refresh_start": "Старт обновления описаний в журнале звонков",
  "cdr.sides.refresh_finish": "Завершение обновления описаний в журнале звонков",
  "api_key.create": "Создание API-ключа",
  "api_key.revoke": "Отзыв API-ключа",
  "users.change": "Изменение пользователя",
};

export function formatAuditTimestamp(
  value: string | null | undefined,
  timeZone: string,
): string {
  return formatDisplayTimestamp(value, timeZone);
}

export function formatAuditAction(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function formatAuditActor(item: AuditLogDisplayItem): string {
  if (item.actorUsername) return item.actorUsername;
  if (item.actorUserId) return item.actorUserId.slice(0, 8) + "…";
  return "система / аноним";
}

export function formatAuditTarget(item: AuditLogDisplayItem): string {
  if (!item.entityType && !item.entityId) return "—";
  if (item.entityType && item.entityId) {
    return `${item.entityType}:${item.entityId}`;
  }
  return item.entityType ?? item.entityId ?? "—";
}

/** Short one-line meta summary; omit empty / redacted-only noise. */
export function summarizeAuditMeta(
  meta: Record<string, unknown> | null | undefined,
  maxKeys = 4,
): string {
  if (!meta) return "—";
  const entries = Object.entries(meta).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "—";

  const parts = entries.slice(0, maxKeys).map(([k, v]) => {
    if (v === "[REDACTED]") return `${k}=[REDACTED]`;
    if (v === null) return `${k}=null`;
    if (typeof v === "object") return `${k}={…}`;
    const text = String(v);
    return `${k}=${text.length > 40 ? `${text.slice(0, 37)}…` : text}`;
  });

  if (entries.length > maxKeys) {
    parts.push(`+${entries.length - maxKeys} ещё`);
  }
  return parts.join(", ");
}

export function auditMetaHasDetails(
  meta: Record<string, unknown> | null | undefined,
): boolean {
  return Boolean(meta && Object.keys(meta).length > 0);
}

export type AuditListQuery = {
  action?: string;
  actor?: string;
  page?: number;
  pageSize?: number;
};

export function buildAuditListUrl(query: AuditListQuery = {}): string {
  const params = new URLSearchParams();
  const action = query.action?.trim();
  if (action) params.set("action", action);
  const actor = query.actor?.trim();
  if (actor) params.set("actor", actor);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  if (query.pageSize && query.pageSize !== 100) {
    params.set("pageSize", String(query.pageSize));
  }
  const qs = params.toString();
  return qs ? `/api/audit?${qs}` : "/api/audit";
}
