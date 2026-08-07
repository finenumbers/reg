/**
 * Presentation helpers for registrations UI — pure, testable, no React.
 */

import { encodeFilters, type ColumnFilters } from "@/components/column-filters/types";
import type { RegistrationHistoryItem, RegistrationListItem } from "@/modules/registrations/types";

export function formatEndpoint(ip: string | null, port: number | null): string {
  if (!ip) return "—";
  if (port == null) return ip;
  return `${ip}:${port}`;
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function statusBadgeVariant(
  status: RegistrationListItem["status"],
): "default" | "secondary" | "outline" {
  return status === "Registered" ? "default" : "secondary";
}

export function formatRegStatus(status: string): string {
  if (status === "Registered") return "Зарегистрирован";
  if (status === "Unregistered") return "Не зарегистрирован";
  return status;
}

export function displayFacetForColumn(column: string, value: string): string {
  if (value === "" || value === "__empty__") return "(пусто)";
  if (column === "status") return formatRegStatus(value);
  if (column === "lastChangedAt" || column === "lastSeenAt") {
    return formatTimestamp(value);
  }
  return value;
}

export const REG_COLUMN_HEADERS: Record<string, string> = {
  phone: "Телефон",
  description: "Описание",
  status: "Статус",
  endpoint: "Endpoint",
  lastChangedAt: "Последнее изменение",
  lastSeenAt: "Обновление",
};

export function describeHistoryEvent(event: RegistrationHistoryItem): string {
  const parts: string[] = [];
  if (event.oldStatus == null) {
    parts.push(`Впервые как ${formatRegStatus(event.newStatus)}`);
  } else if (event.oldStatus !== event.newStatus) {
    parts.push(
      `${formatRegStatus(event.oldStatus)} → ${formatRegStatus(event.newStatus)}`,
    );
  } else {
    parts.push(`Статус без изменений (${formatRegStatus(event.newStatus)})`);
  }

  const oldEp = formatEndpoint(event.oldIp, event.oldPort);
  const newEp = formatEndpoint(event.newIp, event.newPort);
  if (oldEp !== newEp) {
    parts.push(`endpoint ${oldEp} → ${newEp}`);
  }

  return parts.join("; ");
}

export type RegsListQuery = {
  filters?: ColumnFilters;
  phoneQ?: string;
  page?: number;
  pageSize?: number;
};

/** Build GET /api/regs query string from UI filters. */
export function buildRegsListUrl(query: RegsListQuery = {}): string {
  const params = new URLSearchParams();
  const encoded = query.filters ? encodeFilters(query.filters) : null;
  if (encoded) params.set("filters", encoded);
  const phoneQ = query.phoneQ?.trim();
  if (phoneQ) params.set("phoneQ", phoneQ);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  if (query.pageSize && query.pageSize !== 100) {
    params.set("pageSize", String(query.pageSize));
  }
  const qs = params.toString();
  return qs ? `/api/regs?${qs}` : "/api/regs";
}

export function buildRegsFacetsUrl(opts: {
  column: string;
  filters?: ColumnFilters;
  phoneQ?: string;
  q?: string;
  limit?: number;
}): string {
  const params = new URLSearchParams();
  params.set("column", opts.column);
  const encoded = opts.filters ? encodeFilters(opts.filters) : null;
  if (encoded) params.set("filters", encoded);
  if (opts.phoneQ?.trim()) params.set("phoneQ", opts.phoneQ.trim());
  if (opts.q?.trim()) params.set("q", opts.q.trim());
  if (opts.limit != null) params.set("limit", String(opts.limit));
  return `/api/regs/facets?${params.toString()}`;
}
