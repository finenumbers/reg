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
import {
  CDR_VACUUM_BUSY_MESSAGE,
  isDatabaseVacuumActive,
} from "@/modules/storage/vacuum/gate";
import { getJobRunSummary } from "@/modules/jobs/query";
import { findLastFileImport } from "@/modules/jobs/last-file-import";
import { lastRtuEmptyScanAt } from "@/modules/jobs/scheduler";
import {
  applyMonthFilter,
  currentUtcMonth,
  resolveMonthKey,
  sumMonthRecordCounts,
  type CdrMonth,
} from "@/modules/traffic/cdr-month";
import { listCachedMonthCounts } from "@/modules/traffic/cdr-month-stats";
import { countInboxFiles } from "@/modules/traffic/inbox";
import { listPoisonEntries } from "@/modules/traffic/poison";
import { oprsGuiHost } from "@/modules/oprs/calltrace";
import { calltraceCells, parseVoipmonitorLegs } from "@/modules/voipmonitor/legs";
import { splitCdrDateParts } from "@/modules/traffic/cdr-date-parts";
import {
  CALL_CLASS_COLUMNS,
  CDR_COLUMNS,
  CDR_DATETIME_SPLIT_COLUMNS,
  CDR_ENRICH_COLUMNS,
  CDR_PHONE_COLUMNS,
  csvHeaderToCamel,
  isTrafficColumn,
} from "@/modules/traffic/columns";
import { CDR_TARIFF_COLUMNS } from "@/modules/traffic/cdr-tariff";
import { facetSearchMatch } from "@/modules/traffic/facet-search";
import {
  arrangeTrafficFacetItems,
  trafficFacetGroupOrder,
  trafficListOrderBy,
  type TimeSort,
} from "@/modules/traffic/traffic-sort";
import { withCdrReadTimeout } from "@/modules/traffic/read-timeout";
import {
  buildTrafficNoRtpCountSql,
  buildTrafficNoRtpFacetSql,
  buildTrafficNoRtpPageSql,
  trafficNoRtpCanMatch,
  trafficSqlAppliesRtpGate,
  type TrafficNoRtpSqlInput,
} from "@/modules/traffic/rtp-filter-sql";
import { trafficFlagWhere, type TrafficRowFlags } from "@/modules/traffic/row-flags";
import {
  cdrHasBlockedNumber,
  type CdrBlockedNumberSource,
} from "@/modules/traffic/blocked-number";
import { loadBlockedNumbers } from "@/modules/phones/blocked-numbers";

export type { CdrMonth };

export type TrafficListItem = {
  id: string;
  cdrAt: string | null;
  data: Record<string, string>;
  /** A blocked endpoint appears in a calling, called, billing, or redirect field. */
  blocked?: boolean;
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
  lastPassAt: string | null;
  hadCalls: boolean;
  lastCheckedAt: string | null;
  poisonFiles?: Array<{
    filename: string;
    error: string;
    heldForPurge: boolean;
  }>;
};

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
  for (const col of CALL_CLASS_COLUMNS) {
    const value = row[csvHeaderToCamel(col)];
    data[col] = value == null ? "" : String(value);
  }
  for (const col of CDR_TARIFF_COLUMNS) {
    const value = row[csvHeaderToCamel(col)];
    data[col] = value == null ? "" : String(value);
  }
  const fallback = splitCdrDateParts(data.cdr_date ?? "");
  for (const col of CDR_DATETIME_SPLIT_COLUMNS) {
    const stored = row[csvHeaderToCamel(col)];
    const asText = stored == null ? "" : String(stored);
    data[col] = asText || (col === "cdr_day" ? fallback.day : fallback.time);
  }
  const cells = calltraceCells(parseVoipmonitorLegs(link?.voipmonitorLegs), guiUrl);
  data.voipmonitor_url_in = cells.inUrl;
  data.voipmonitor_cdr_id_in = cells.inId;
  data.voipmonitor_url_out = cells.outUrl;
  data.voipmonitor_cdr_id_out = cells.outId;
  data.rtp = cells.rtp;
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

async function listTrafficMonths(): Promise<CdrMonth[]> {
  return listCachedMonthCounts();
}

function asCount(value: unknown): number {
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error("Некорректный подсчёт");
  }
  return n;
}

async function readVoipmonitorGui(): Promise<{ guiUrl: string; guiHost: string }> {
  const setting = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: { voipmonitorGuiUrl: true },
  });
  const guiUrl = setting?.voipmonitorGuiUrl?.trim() ?? "";
  return { guiUrl, guiHost: oprsGuiHost(guiUrl) };
}

function emptyTrafficPage(
  month: CdrMonth,
  page: number,
  pageSize: number,
  months?: CdrMonth[],
): ListTrafficResult {
  return {
    items: [],
    headers: [...CDR_COLUMNS],
    total: 0,
    page,
    pageSize,
    month: month.key,
    months,
  };
}

type TrafficRow = CdrBlockedNumberSource & {
  id: string;
  cdrAt: Date | null;
};

async function hydrateTrafficRows(
  rows: TrafficRow[],
  guiUrl: string,
  blockedNumbers: Awaited<ReturnType<typeof loadBlockedNumbers>>,
): Promise<TrafficListItem[]> {
  if (rows.length === 0) return [];
  const links = await prisma.cdrVoipmonitorLink.findMany({
    where: { cdrRecordId: { in: rows.map((row) => row.id) } },
    select: { cdrRecordId: true, voipmonitorLegs: true },
  });
  const linkById = new Map(links.map((link) => [link.cdrRecordId, link]));
  return rows.map((row) => ({
    id: row.id,
    cdrAt: row.cdrAt?.toISOString() ?? null,
    data: rowToData(
      row as unknown as Record<string, unknown>,
      linkById.get(row.id),
      guiUrl,
    ),
    ...(cdrHasBlockedNumber(blockedNumbers, row) ? { blocked: true as const } : {}),
  }));
}

export async function listTraffic(opts: {
  filters?: ColumnFilters;
  phoneQ?: string;
  month?: string;
  phantom?: boolean;
  callErrors?: boolean;
  parking?: boolean;
  failed?: boolean;
  check?: boolean;
  success?: boolean;
  noRtp?: boolean;
  timeSort?: TimeSort | null;
  durationSort?: TimeSort | null;
  chargeSort?: TimeSort | null;
  page?: number;
  pageSize?: number;
}): Promise<ListTrafficResult> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 100));
  const filters = opts.filters ?? {};
  const phoneQ = opts.phoneQ?.trim() ?? "";
  const month = resolveMonthKey(opts.month);
  const chargeSort = opts.chargeSort ?? null;
  const durationSort = chargeSort ? null : (opts.durationSort ?? null);
  const flags = {
    phantom: opts.phantom,
    callErrors: opts.callErrors,
    parking: opts.parking,
    failed: opts.failed,
    check: opts.check,
    success: opts.success,
    noRtp: opts.noRtp,
  };
  if (opts.noRtp || durationSort || chargeSort) {
    return listTrafficBySql({
      filters,
      phoneQ,
      month,
      flags,
      timeSort: durationSort || chargeSort ? null : (opts.timeSort ?? null),
      durationSort,
      chargeSort,
      rtpGate: trafficSqlAppliesRtpGate(opts.noRtp),
      page,
      pageSize,
    });
  }
  const where = buildWhere(filters, phoneQ, month, flags);
  const skip = (page - 1) * pageSize;
  const includeMonths = page === 1;

  const [total, rows, months, blockedNumbers] = await Promise.all([
    prisma.cdrRecord.count({ where }),
    prisma.cdrRecord.findMany({
      where,
      orderBy: trafficListOrderBy(opts.timeSort ?? null),
      skip,
      take: pageSize,
    }),
    includeMonths ? listTrafficMonths() : Promise.resolve(undefined),
    loadBlockedNumbers(),
  ]);

  const guiUrl =
    rows.length === 0
      ? ""
      : ((
          await prisma.appSetting.findUnique({
            where: { id: 1 },
            select: { voipmonitorGuiUrl: true },
          })
        )?.voipmonitorGuiUrl?.trim() ?? "");

  return {
    items: await hydrateTrafficRows(rows, guiUrl, blockedNumbers),
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

/** Server pages only. The list API keeps its own 409 and does not use this. */
export async function loadTrafficPageInitial(): Promise<{
  initial: ListTrafficResult;
  initialListError: string | null;
}> {
  if (isDatabaseVacuumActive()) {
    const month = currentUtcMonth();
    return {
      initial: {
        items: [],
        headers: [...CDR_COLUMNS],
        total: 0,
        page: 1,
        pageSize: TABLE_PAGE_SIZE,
        month: month.key,
        months: [month],
      },
      initialListError: CDR_VACUUM_BUSY_MESSAGE,
    };
  }
  return { initial: await loadTrafficViewData(), initialListError: null };
}

export async function listTrafficFacets(opts: {
  column: string;
  filters?: ColumnFilters;
  phoneQ?: string;
  month?: string;
  phantom?: boolean;
  callErrors?: boolean;
  parking?: boolean;
  failed?: boolean;
  check?: boolean;
  success?: boolean;
  noRtp?: boolean;
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
  const flags = {
    phantom: opts.phantom,
    callErrors: opts.callErrors,
    parking: opts.parking,
    failed: opts.failed,
    check: opts.check,
    success: opts.success,
    noRtp: opts.noRtp,
  };
  if (opts.noRtp) {
    return listTrafficFacetsWithoutRtp({
      column,
      filters: opts.filters ?? {},
      phoneQ,
      month,
      flags,
      q,
      limit,
    });
  }
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
    orderBy: trafficFacetGroupOrder(column),
    take: limit + 1,
  });

  const mapped = grouped.map((row) => {
    const raw = (row as Record<string, unknown>)[field];
    return {
      value: toFilterToken(raw == null ? "" : String(raw)),
      count: row._count,
    };
  });
  const items = arrangeTrafficFacetItems(column, mapped);
  return {
    items: items.slice(0, limit),
    truncated: grouped.length > limit,
  };
}

async function listTrafficBySql(input: {
  filters: ColumnFilters;
  phoneQ: string;
  month: CdrMonth;
  flags: TrafficRowFlags;
  timeSort: TimeSort | null;
  durationSort: TimeSort | null;
  chargeSort: TimeSort | null;
  /** True only for «Нет RTP». A seconds or cost sort must not take the empty-host shortcut. */
  rtpGate: boolean;
  page: number;
  pageSize: number;
}): Promise<ListTrafficResult> {
  const includeMonths = input.page === 1;
  const { guiUrl, guiHost } = await readVoipmonitorGui();
  if (input.rtpGate && !trafficNoRtpCanMatch(input.flags, guiHost)) {
    const months = includeMonths ? await listTrafficMonths() : undefined;
    return emptyTrafficPage(input.month, input.page, input.pageSize, months);
  }
  const query: TrafficNoRtpSqlInput = {
    year: input.month.year,
    month: input.month.month,
    filters: input.filters,
    phoneQ: input.phoneQ,
    flags: input.flags,
    guiHost,
    timeSort: input.timeSort,
    durationSort: input.durationSort,
    chargeSort: input.chargeSort,
  };
  const skip = (input.page - 1) * input.pageSize;
  const [counted, months, blockedNumbers] = await Promise.all([
    withCdrReadTimeout(async (tx) => {
      const counts = await tx.$queryRaw<Array<{ count: unknown }>>(
        buildTrafficNoRtpCountSql(query),
      );
      const ids = await tx.$queryRaw<Array<{ id: string }>>(
        buildTrafficNoRtpPageSql(query, input.pageSize, skip),
      );
      return { total: asCount(counts[0]?.count ?? 0), ids };
    }),
    includeMonths ? listTrafficMonths() : Promise.resolve(undefined),
    loadBlockedNumbers(),
  ]);
  const idOrder = new Map(counted.ids.map((row, index) => [row.id, index]));
  const rows =
    counted.ids.length === 0
      ? []
      : await prisma.cdrRecord.findMany({
          where: { id: { in: counted.ids.map((row) => row.id) } },
        });
  rows.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));
  return {
    items: await hydrateTrafficRows(rows, guiUrl, blockedNumbers),
    headers: [...CDR_COLUMNS],
    total: counted.total,
    page: input.page,
    pageSize: input.pageSize,
    month: input.month.key,
    months,
  };
}

async function listTrafficFacetsWithoutRtp(input: {
  column: string;
  filters: ColumnFilters;
  phoneQ: string;
  month: CdrMonth;
  flags: TrafficRowFlags;
  q: string;
  limit: number;
}): Promise<FacetResponse> {
  const { guiHost } = await readVoipmonitorGui();
  if (!trafficNoRtpCanMatch(input.flags, guiHost)) {
    return { items: [], truncated: false };
  }
  const query: TrafficNoRtpSqlInput = {
    year: input.month.year,
    month: input.month.month,
    filters: input.filters,
    phoneQ: input.phoneQ,
    flags: input.flags,
    guiHost,
    timeSort: null,
  };
  const grouped = await withCdrReadTimeout((tx) =>
    tx.$queryRaw<Array<{ value: string | null; count: unknown }>>(
      buildTrafficNoRtpFacetSql(query, input.column, input.q, input.limit),
    ),
  );
  const items = arrangeTrafficFacetItems(
    input.column,
    grouped.slice(0, input.limit).map((row) => ({
      value: toFilterToken(row.value == null ? "" : String(row.value)),
      count: asCount(row.count),
    })),
  );
  return {
    items,
    truncated: grouped.length > input.limit,
  };
}

export async function getTrafficStatus(): Promise<TrafficOperationalStatus> {
  const [summary, months, inbox, filePass] = await Promise.all([
    getJobRunSummary("cdr.import"),
    listCachedMonthCounts(),
    countInboxFiles(),
    findLastFileImport("cdr.import"),
  ]);
  const last = summary.lastAny;
  const checkedAt = lastRtuEmptyScanAt();
  return {
    lastJobStatus: last ? last.status : summary.runningCount > 0 ? "running" : "never",
    lastError: last?.status === "failed" ? last.errorMessage : null,
    lastFinishedAt: last?.finishedAt ?? null,
    lastFailedError: summary.lastFailed?.errorMessage ?? null,
    runningCount: summary.runningCount,
    recordCount: sumMonthRecordCounts(months),
    pendingInboxCount: inbox.pending,
    poisonedCount: inbox.poisoned,
    lastPassAt: filePass.lastPassAt,
    hadCalls: filePass.hadCalls,
    lastCheckedAt: checkedAt == null ? null : new Date(checkedAt).toISOString(),
    poisonFiles: listPoisonEntries(),
  };
}
