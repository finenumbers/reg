/**
 * Phone traffic query — local CDR table.
 */

import type { Prisma } from "@/generated/prisma/client";
import {
  EMPTY_FILTER_TOKEN,
  facetQueryMatchesEmptyLabel,
  toFilterToken,
  type ColumnFilters,
  type FacetResponse,
} from "@/components/column-filters/types";
import { prisma } from "@/lib/db";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import { getJobRunSummary } from "@/modules/jobs/query";
import {
  applyMonthFilter,
  CDR_DATE_BOUND_GTE,
  CDR_DATE_BOUND_LT,
  currentUtcMonth,
  monthsFromCdrDateBounds,
  resolveMonthKey,
  type CdrMonth,
} from "@/modules/traffic/cdr-month";
import { countInboxFiles } from "@/modules/traffic/inbox";
import { parseVoipmonitorLegs } from "@/modules/voipmonitor/legs";
import type { VoipmonitorLegs } from "@/modules/voipmonitor/types";
import { isSafeVoipmonitorHref } from "@/modules/voipmonitor/url";
import { splitCdrDateParts } from "@/modules/traffic/cdr-date-parts";
import {
  CDR_COLUMNS,
  CDR_DATETIME_SPLIT_COLUMNS,
  CDR_ENRICH_COLUMNS,
  CDR_PHONE_COLUMNS,
  csvHeaderToCamel,
  isTrafficColumn,
} from "@/modules/traffic/columns";
import { facetSearchMatch } from "@/modules/traffic/facet-search";
import {
  trafficFlagWhere,
  type TrafficRowFlags,
} from "@/modules/traffic/row-flags";

export type { CdrMonth };

export type TrafficListItem = {
  id: string;
  cdrAt: string | null;
  data: Record<string, string>;
};

export type ListTrafficResult = {
  items: TrafficListItem[];
  headers: string[];
  total: number;
  page: number;
  pageSize: number;
  month: string;
  months?: CdrMonth[];
};

export type TrafficOperationalStatus = {
  lastJobStatus: "success" | "failed" | "running" | "never" | null;
  lastError: string | null;
  lastFinishedAt: string | null;
  lastFailedError: string | null;
  runningCount: number;
  recordCount: number;
  pendingInboxCount: number;
  poisonedCount: number;
};

function safeLeg(
  ref: { url: string; cdrId: string } | undefined,
  guiUrl: string,
): { url: string; cdrId: string } {
  if (!ref?.url || !guiUrl || !isSafeVoipmonitorHref(ref.url, guiUrl)) {
    return { url: "", cdrId: "" };
  }
  return { url: ref.url, cdrId: ref.cdrId };
}

function rowToData(
  row: Record<string, unknown>,
  link?: { voipmonitorLegs: unknown } | null,
  guiUrl = "",
): Record<string, string> {
  const data: Record<string, string> = {};
  for (const col of CDR_COLUMNS) {
    const value = row[csvHeaderToCamel(col)];
    data[col] = value == null ? "" : String(value);
  }
  for (const col of CDR_ENRICH_COLUMNS) {
    const value = row[csvHeaderToCamel(col)];
    data[col] = value == null ? "" : String(value);
  }
  const fallback = splitCdrDateParts(data.cdr_date ?? "");
  for (const col of CDR_DATETIME_SPLIT_COLUMNS) {
    const stored = row[csvHeaderToCamel(col)];
    const asText = stored == null ? "" : String(stored);
    data[col] = asText || (col === "cdr_day" ? fallback.day : fallback.time);
  }
  const legs: VoipmonitorLegs = parseVoipmonitorLegs(link?.voipmonitorLegs);
  const inn = safeLeg(legs.in, guiUrl);
  const out = safeLeg(legs.out, guiUrl);
  data.voipmonitor_url_in = inn.url;
  data.voipmonitor_cdr_id_in = inn.cdrId;
  data.voipmonitor_url_out = out.url;
  data.voipmonitor_cdr_id_out = out.cdrId;
  return data;
}

export function applyColumnFilters(
  base: Prisma.CdrRecordWhereInput,
  filters: ColumnFilters,
  opts: { excludeColumn?: string } = {},
): Prisma.CdrRecordWhereInput {
  const extras: Prisma.CdrRecordWhereInput[] = [];
  for (const [column, values] of Object.entries(filters)) {
    if (opts.excludeColumn && column === opts.excludeColumn) continue;
    if (!values?.length || !isTrafficColumn(column)) continue;
    const field = csvHeaderToCamel(column);
    extras.push({
      OR: values.map((raw) => ({
        [field]: raw === EMPTY_FILTER_TOKEN ? "" : raw,
      })),
    });
  }
  if (extras.length === 0) return base;
  return { AND: [base, ...extras] };
}

export function containsInsensitive(needle: string) {
  return { contains: needle, mode: "insensitive" as const };
}

export function applyPhoneQ(
  base: Prisma.CdrRecordWhereInput,
  phoneQ: string,
): Prisma.CdrRecordWhereInput {
  const q = phoneQ.trim();
  if (!q) return base;
  return {
    AND: [
      base,
      {
        OR: CDR_PHONE_COLUMNS.map((col) => ({
          [csvHeaderToCamel(col)]: containsInsensitive(q),
        })),
      },
    ],
  };
}

function applyTrafficFlags(
  base: Prisma.CdrRecordWhereInput,
  flags: TrafficRowFlags,
): Prisma.CdrRecordWhereInput {
  const extra = trafficFlagWhere(flags);
  if (!extra) return base;
  return { AND: [base, extra] };
}

function buildWhere(
  filters: ColumnFilters,
  phoneQ: string,
  month: CdrMonth,
  flags: TrafficRowFlags = {},
  opts: { excludeColumn?: string } = {},
): Prisma.CdrRecordWhereInput {
  return applyTrafficFlags(
    applyPhoneQ(
      applyColumnFilters(applyMonthFilter(month.year, month.month), filters, opts),
      phoneQ,
    ),
    flags,
  );
}

function withEmptyFacetMatch(
  field: string,
  q: string,
  valueWhere: Prisma.CdrRecordWhereInput,
): Prisma.CdrRecordWhereInput {
  if (!facetQueryMatchesEmptyLabel(q)) return valueWhere;
  const empty = { [field]: "" } as Prisma.CdrRecordWhereInput;
  const keys = Object.keys(valueWhere);
  if (keys.length === 0) return empty;
  if (valueWhere.OR && keys.length === 1) {
    return { OR: [...valueWhere.OR, empty] };
  }
  return { OR: [valueWhere, empty] };
}

export function facetSearchWhere(
  field: string,
  column: string,
  q: string,
): Prisma.CdrRecordWhereInput {
  const match = facetSearchMatch(column, q);
  if (match.kind === "in") {
    return withEmptyFacetMatch(field, q, { [field]: { in: match.values } });
  }
  if (match.needles.length === 0) {
    return withEmptyFacetMatch(field, q, {});
  }
  if (match.needles.length === 1) {
    return withEmptyFacetMatch(field, q, {
      [field]: containsInsensitive(match.needles[0]),
    });
  }
  return withEmptyFacetMatch(field, q, {
    OR: match.needles.map((needle) => ({
      [field]: containsInsensitive(needle),
    })),
  });
}

async function listTrafficMonths(current: CdrMonth): Promise<CdrMonth[]> {
  const bounds = await prisma.cdrRecord.aggregate({
    where: {
      cdrDate: { gte: CDR_DATE_BOUND_GTE, lt: CDR_DATE_BOUND_LT },
    },
    _min: { cdrDate: true },
    _max: { cdrDate: true },
  });
  return monthsFromCdrDateBounds(
    bounds._min.cdrDate,
    bounds._max.cdrDate,
    current,
  );
}

export async function listTraffic(opts: {
  filters?: ColumnFilters;
  phoneQ?: string;
  month?: string;
  phantom?: boolean;
  callErrors?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<ListTrafficResult> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 100));
  const filters = opts.filters ?? {};
  const phoneQ = opts.phoneQ?.trim() ?? "";
  const month = resolveMonthKey(opts.month);
  const flags = { phantom: opts.phantom, callErrors: opts.callErrors };
  const where = buildWhere(filters, phoneQ, month, flags);
  const skip = (page - 1) * pageSize;
  const includeMonths = page === 1;

  const [total, rows, months] = await Promise.all([
    prisma.cdrRecord.count({ where }),
    prisma.cdrRecord.findMany({
      where,
      orderBy: [{ cdrDate: "desc" }, { cdrId: "desc" }],
      skip,
      take: pageSize,
    }),
    includeMonths ? listTrafficMonths(currentUtcMonth()) : Promise.resolve(undefined),
  ]);

  const [links, guiSetting] =
    rows.length === 0
      ? [[], null]
      : await Promise.all([
          prisma.cdrVoipmonitorLink.findMany({
            where: { cdrRecordId: { in: rows.map((row) => row.id) } },
            select: {
              cdrRecordId: true,
              voipmonitorLegs: true,
            },
          }),
          prisma.appSetting.findUnique({
            where: { id: 1 },
            select: { voipmonitorGuiUrl: true },
          }),
        ]);
  const guiUrl = guiSetting?.voipmonitorGuiUrl?.trim() ?? "";
  const linkById = new Map(links.map((link) => [link.cdrRecordId, link]));

  return {
    items: rows.map((row) => ({
      id: row.id,
      cdrAt: row.cdrAt?.toISOString() ?? null,
      data: rowToData(
        row as unknown as Record<string, unknown>,
        linkById.get(row.id),
        guiUrl,
      ),
    })),
    headers: [...CDR_COLUMNS],
    total,
    page,
    pageSize,
    month: month.key,
    months,
  };
}

export async function loadTrafficViewData(): Promise<ListTrafficResult> {
  return listTraffic({
    page: 1,
    pageSize: TABLE_PAGE_SIZE,
    month: currentUtcMonth().key,
  });
}

export async function listTrafficFacets(opts: {
  column: string;
  filters?: ColumnFilters;
  phoneQ?: string;
  month?: string;
  phantom?: boolean;
  callErrors?: boolean;
  q?: string;
  limit?: number;
}): Promise<FacetResponse> {
  const column = opts.column.trim();
  if (!isTrafficColumn(column)) {
    return { items: [], truncated: false };
  }
  const field = csvHeaderToCamel(column);
  const limit = Math.min(500, Math.max(1, opts.limit ?? 200));
  const phoneQ = opts.phoneQ?.trim() ?? "";
  const q = opts.q?.trim() ?? "";
  const month = resolveMonthKey(opts.month);
  const flags = { phantom: opts.phantom, callErrors: opts.callErrors };
  const where = buildWhere(opts.filters ?? {}, phoneQ, month, flags, {
    excludeColumn: column,
  });
  const fieldWhere: Prisma.CdrRecordWhereInput = q
    ? { AND: [where, facetSearchWhere(field, column, q)] }
    : where;

  const grouped = await prisma.cdrRecord.groupBy({
    by: [field as Prisma.CdrRecordScalarFieldEnum],
    where: fieldWhere,
    _count: true,
    orderBy: { _count: { id: "desc" } },
    take: limit + 1,
  });

  const items = grouped.map((row) => {
    const raw = (row as Record<string, unknown>)[field];
    return {
      value: toFilterToken(raw == null ? "" : String(raw)),
      count: row._count,
    };
  });
  return {
    items: items.slice(0, limit),
    truncated: grouped.length > limit,
  };
}

export async function getTrafficStatus(): Promise<TrafficOperationalStatus> {
  const [summary, recordCount, inbox] = await Promise.all([
    getJobRunSummary("cdr.import"),
    prisma.cdrRecord.count(),
    countInboxFiles(),
  ]);
  const last = summary.lastAny;
  return {
    lastJobStatus: last
      ? last.status
      : summary.runningCount > 0
        ? "running"
        : "never",
    lastError: last?.status === "failed" ? last.errorMessage : null,
    lastFinishedAt: last?.finishedAt ?? null,
    lastFailedError: summary.lastFailed?.errorMessage ?? null,
    runningCount: summary.runningCount,
    recordCount,
    pendingInboxCount: inbox.pending,
    poisonedCount: inbox.poisoned,
  };
}
