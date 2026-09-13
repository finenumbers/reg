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
import { chunkArray, DB_IN_CHUNK } from "@/lib/chunk";
import { prisma } from "@/lib/db";
import { getDisplayTimezone } from "@/modules/settings";
import {
  enqueueStaleGeoLookups,
  awaitStaleGeoLookups,
  loadGeoCacheByIps,
  uniqueLookupIps,
} from "@/modules/geoip";
import {
  buildPhoneEndpointEnrichmentMap,
  type PhoneEndpointEnrichment,
} from "@/modules/registrations/phone-description";
import {
  applyRegistrationQuery,
  columnCellValue,
} from "@/modules/registrations/query-filter";
import { sortRegistrationItemsByPhone } from "@/modules/registrations/sort";
import type {
  RegistrationHistoryItem,
  RegistrationListItem,
} from "@/modules/registrations/types";
import {
  formatRegStatus,
  formatTimestamp,
  REG_COLUMN_HEADERS,
} from "@/modules/registrations/ui-format";

export type ListRegistrationsFilters = {
  /** Substring search over Телефон (toolbar) */
  phoneQ?: string;
  filters?: ColumnFilters;
  /** Toolbar «Без регистрации» — status === Unregistered */
  unregisteredOnly?: boolean;
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
  enrichment: PhoneEndpointEnrichment | undefined = undefined,
  geo: { country: string | null; city: string | null; isp: string | null } | null = null,
): RegistrationListItem {
  return {
    phone: row.phone,
    description: enrichment?.description ?? null,
    channelality: enrichment?.channelality ?? null,
    status: row.status,
    ip: row.ip,
    port: row.port,
    country: geo?.country ?? null,
    city: geo?.city ?? null,
    isp: geo?.isp ?? null,
    lastSeenAt: row.lastSeenAt.toISOString(),
    lastChangedAt: row.lastChangedAt.toISOString(),
  };
}

async function attachGeoFields(
  items: RegistrationListItem[],
  opts: { enqueueMissing?: boolean; wait?: boolean } = {},
): Promise<RegistrationListItem[]> {
  const ips = uniqueLookupIps(items.map((row) => row.ip));
  if (ips.length === 0) return items;

  if (opts.wait) {
    await awaitStaleGeoLookups(ips);
  } else if (opts.enqueueMissing) {
    enqueueStaleGeoLookups(ips);
  }

  const cache = await loadGeoCacheByIps(ips);
  return items.map((row) => {
    if (!row.ip) return row;
    const geo = cache.get(row.ip);
    if (!geo) return row;
    return {
      ...row,
      country: geo.country,
      city: geo.city,
      isp: geo.isp,
    };
  });
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

async function enrichmentForPhones(
  phones: string[],
): Promise<Map<string, PhoneEndpointEnrichment>> {
  const map = new Map<string, PhoneEndpointEnrichment>();
  const unique = [...new Set(phones.map((phone) => phone.trim()).filter(Boolean))];
  if (unique.length === 0) return map;
  for (const batch of chunkArray(unique, DB_IN_CHUNK)) {
    const endpoints = await prisma.phoneEndpoint.findMany({
      where: { endpointNumber: { in: batch } },
      select: { endpointNumber: true, name: true, data: true },
      orderBy: { name: "asc" },
    });
    const part = buildPhoneEndpointEnrichmentMap(endpoints);
    for (const [phone, value] of part) {
      if (!map.has(phone)) map.set(phone, value);
    }
  }
  return map;
}

export async function loadAllRegistrationItems(
  opts: { waitGeo?: boolean } = {},
): Promise<RegistrationListItem[]> {
  const rows = await prisma.registrationCurrent.findMany({
    orderBy: [{ phone: "asc" }],
  });
  const enrichment = await enrichmentForPhones(rows.map((r) => r.phone));
  const items = sortRegistrationItemsByPhone(
    rows.map((row) => toListItem(row, enrichment.get(row.phone.trim()))),
  );
  return attachGeoFields(items, { wait: opts.waitGeo });
}

export async function listRegistrations(
  filters: ListRegistrationsFilters = {},
): Promise<ListRegistrationsResult> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 100));
  const columnFilters = filters.filters ?? {};
  const phoneQ = (filters.phoneQ ?? "").trim();
  const unregisteredOnly = Boolean(filters.unregisteredOnly);

  const all = await loadAllRegistrationItems();
  const filtered = applyRegistrationQuery(all, {
    filters: columnFilters,
    phoneQ,
    unregisteredOnly,
  });
  const skip = (page - 1) * pageSize;
  const pageItems = await attachGeoFields(filtered.slice(skip, skip + pageSize), {
    enqueueMissing: true,
  });

  return {
    items: pageItems,
    total: filtered.length,
    page,
    pageSize,
  };
}

export async function listRegistrationFacets(opts: {
  column: string;
  filters?: ColumnFilters;
  phoneQ?: string;
  unregisteredOnly?: boolean;
  q?: string;
  limit?: number;
}): Promise<FacetResponse> {
  const column = opts.column.trim();
  if (!column || !(column in REG_COLUMN_HEADERS)) {
    return { items: [], truncated: false };
  }

  const phoneQ = opts.phoneQ?.trim() ?? "";
  const all = await loadAllRegistrationItems();
  const filtered = applyRegistrationQuery(all, {
    filters: opts.filters ?? {},
    phoneQ,
    unregisteredOnly: Boolean(opts.unregisteredOnly),
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

  const timeZone = await getDisplayTimezone();
  const items = response.items.filter((item) => {
    const raw = (() => {
      if (item.value === EMPTY_FILTER_TOKEN || item.value === "") return "(пусто)";
      if (column === "status") return formatRegStatus(item.value);
      if (column === "lastChangedAt" || column === "lastSeenAt") {
        return formatTimestamp(item.value, timeZone);
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
  const [events, enrichment] = await Promise.all([
    prisma.registrationEvent.findMany({
      where: { phone: normalized },
      orderBy: { changedAt: "desc" },
      take: historyLimit,
    }),
    enrichmentForPhones([normalized]),
  ]);

  return {
    current: (
      await attachGeoFields(
        [toListItem(current, enrichment.get(normalized))],
        { wait: true },
      )
    )[0]!,
    events: events.map(toHistoryItem),
  };
}
