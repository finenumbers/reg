/**
 * Registrations query service — list current state + phone detail/history.
 * Reads local DB only (never live SSH).
 */

import type { RegStatus } from "@/generated/prisma/client";
import {
  aggregateFacetItems,
  cellToFilterToken,
  EMPTY_FILTER_TOKEN,
  type ColumnFilters,
  type FacetResponse,
} from "@/components/column-filters/types";
import { prisma } from "@/lib/db";
import { buildPhoneDescriptionMap } from "@/modules/registrations/phone-description";
import type {
  RegistrationHistoryItem,
  RegistrationListItem,
} from "@/modules/registrations/types";
import {
  formatEndpoint,
  formatRegStatus,
  formatTimestamp,
  REG_COLUMN_HEADERS,
} from "@/modules/registrations/ui-format";

export { REG_COLUMN_HEADERS };

export const REG_FILTER_COLUMNS = Object.keys(REG_COLUMN_HEADERS);

export type ListRegistrationsFilters = {
  /** @deprecated prefer `filters` column map */
  status?: RegStatus;
  /** @deprecated prefer `filters` column map */
  phone?: string;
  filters?: ColumnFilters;
  page?: number;
  pageSize?: number;
};

export type ListRegistrationsResult = {
  items: RegistrationListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type RegistrationDetailResult = {
  current: RegistrationListItem;
  events: RegistrationHistoryItem[];
};

function toListItem(
  row: {
    phone: string;
    status: RegStatus;
    ip: string | null;
    port: number | null;
    lastSeenAt: Date;
    lastChangedAt: Date;
  },
  description: string | null = null,
): RegistrationListItem {
  return {
    phone: row.phone,
    description,
    status: row.status,
    ip: row.ip,
    port: row.port,
    lastSeenAt: row.lastSeenAt.toISOString(),
    lastChangedAt: row.lastChangedAt.toISOString(),
  };
}

function toHistoryItem(row: {
  id: string;
  phone: string;
  oldStatus: RegStatus | null;
  newStatus: RegStatus;
  oldIp: string | null;
  newIp: string | null;
  oldPort: number | null;
  newPort: number | null;
  changedAt: Date;
}): RegistrationHistoryItem {
  return {
    id: row.id,
    phone: row.phone,
    oldStatus: row.oldStatus,
    newStatus: row.newStatus,
    oldIp: row.oldIp,
    newIp: row.newIp,
    oldPort: row.oldPort,
    newPort: row.newPort,
    changedAt: row.changedAt.toISOString(),
  };
}

async function descriptionsForPhones(
  phones: string[],
): Promise<Map<string, string>> {
  if (phones.length === 0) return new Map();
  const endpoints = await prisma.phoneEndpoint.findMany({
    where: { endpointNumber: { in: phones } },
    select: { endpointNumber: true, name: true, data: true },
    orderBy: { name: "asc" },
  });
  return buildPhoneDescriptionMap(endpoints);
}

function columnCellValue(
  row: RegistrationListItem,
  column: string,
): string {
  switch (column) {
    case "phone":
      return row.phone;
    case "description":
      return row.description ?? "";
    case "status":
      return row.status;
    case "endpoint":
      return formatEndpoint(row.ip, row.port);
    case "lastChangedAt":
      return row.lastChangedAt ?? "";
    case "lastSeenAt":
      return row.lastSeenAt ?? "";
    default:
      return "";
  }
}

function matchesColumnFilter(
  row: RegistrationListItem,
  column: string,
  values: string[],
): boolean {
  if (values.length === 0) return true;
  const token = cellToFilterToken(columnCellValue(row, column));
  return values.includes(token);
}

function applyColumnFilters(
  rows: RegistrationListItem[],
  filters: ColumnFilters,
  opts: { excludeColumn?: string } = {},
): RegistrationListItem[] {
  const entries = Object.entries(filters).filter(
    ([col, values]) =>
      values.length > 0 &&
      (!opts.excludeColumn || col !== opts.excludeColumn),
  );
  if (entries.length === 0) return rows;
  return rows.filter((row) =>
    entries.every(([col, values]) => matchesColumnFilter(row, col, values)),
  );
}

async function loadAllRegistrationItems(): Promise<RegistrationListItem[]> {
  const rows = await prisma.registrationCurrent.findMany({
    orderBy: [{ phone: "asc" }],
  });
  const descriptions = await descriptionsForPhones(rows.map((r) => r.phone));
  return rows.map((row) =>
    toListItem(row, descriptions.get(row.phone) ?? null),
  );
}

/** Merge legacy phone/status params into ColumnFilters. */
function normalizeFilters(filters: ListRegistrationsFilters): ColumnFilters {
  const out: ColumnFilters = { ...(filters.filters ?? {}) };
  if (filters.status && !out.status?.length) {
    out.status = [filters.status];
  }
  if (filters.phone?.trim() && !out.phone?.length) {
    // legacy substring → exact token list not available; keep as single contains via special handling
    // Represent as filter value that list will match with includes for backward compat in tests
    out.phone = [filters.phone.trim()];
  }
  return out;
}

function matchesWithLegacyPhoneContains(
  row: RegistrationListItem,
  filters: ColumnFilters,
  opts: { excludeColumn?: string } = {},
): boolean {
  for (const [col, values] of Object.entries(filters)) {
    if (opts.excludeColumn && col === opts.excludeColumn) continue;
    if (!values?.length) continue;
    if (col === "phone") {
      // Multi-select exact OR legacy single substring (when one value and not full phone set from facets)
      const token = cellToFilterToken(row.phone);
      const ok = values.some(
        (v) =>
          v === token ||
          (v !== EMPTY_FILTER_TOKEN &&
            row.phone.toLowerCase().includes(v.toLowerCase())),
      );
      if (!ok) return false;
      continue;
    }
    if (!matchesColumnFilter(row, col, values)) return false;
  }
  return true;
}

export async function listRegistrations(
  filters: ListRegistrationsFilters = {},
): Promise<ListRegistrationsResult> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 100));
  const columnFilters = normalizeFilters(filters);

  const all = await loadAllRegistrationItems();
  const filtered = all.filter((row) =>
    matchesWithLegacyPhoneContains(row, columnFilters),
  );
  const skip = (page - 1) * pageSize;

  return {
    items: filtered.slice(skip, skip + pageSize),
    total: filtered.length,
    page,
    pageSize,
  };
}

export async function listRegistrationFacets(opts: {
  column: string;
  filters?: ColumnFilters;
  q?: string;
  limit?: number;
}): Promise<FacetResponse> {
  const column = opts.column.trim();
  if (!column || !(column in REG_COLUMN_HEADERS)) {
    return { items: [], truncated: false };
  }

  const all = await loadAllRegistrationItems();
  const filtered = applyColumnFilters(all, opts.filters ?? {}, {
    excludeColumn: column,
  });

  const values = filtered.map((row) =>
    cellToFilterToken(columnCellValue(row, column)),
  );

  const response = aggregateFacetItems(values, {
    q: undefined,
    limit: opts.limit,
  });

  const q = opts.q?.trim().toLowerCase() ?? "";
  if (!q) return response;

  const items = response.items.filter((item) => {
    const raw = (() => {
      if (item.value === EMPTY_FILTER_TOKEN || item.value === "") return "(пусто)";
      if (column === "status") return formatRegStatus(item.value);
      if (column === "lastChangedAt" || column === "lastSeenAt") {
        return formatTimestamp(item.value);
      }
      return item.value;
    })().toLowerCase();
    return raw.includes(q);
  });
  const limit = Math.min(500, Math.max(1, opts.limit ?? 200));
  return {
    items: items.slice(0, limit),
    truncated: items.length > limit || response.truncated,
  };
}

export async function getRegistrationDetail(
  phone: string,
  options: { historyLimit?: number } = {},
): Promise<RegistrationDetailResult | null> {
  const normalized = phone.trim();
  if (!normalized) return null;

  const current = await prisma.registrationCurrent.findUnique({
    where: { phone: normalized },
  });
  if (!current) return null;

  const historyLimit = Math.min(500, Math.max(1, options.historyLimit ?? 100));
  const [events, descriptions] = await Promise.all([
    prisma.registrationEvent.findMany({
      where: { phone: normalized },
      orderBy: { changedAt: "desc" },
      take: historyLimit,
    }),
    descriptionsForPhones([normalized]),
  ]);

  return {
    current: toListItem(current, descriptions.get(normalized) ?? null),
    events: events.map(toHistoryItem),
  };
}
