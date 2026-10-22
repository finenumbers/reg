import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { formatDisplayTimestamp } from "@/lib/format-display-time";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import {
  EMPTY_FILTER_TOKEN,
  type ColumnFilters,
} from "@/components/column-filters/types";
import { isRadiusFacetColumn, type RadiusFacetColumn } from "@/modules/antifraud/columns";
import { parseMonthKey, zonedMonth, zonedMonthRange } from "@/modules/antifraud/month";
import { formatMonthOption } from "@/modules/traffic/month-labels";
import type { TimeSort } from "@/modules/traffic/traffic-sort";

/** The АнтиФрод journal is UTC. The display timezone is not applied here. */
const PAGE_ZONE = "UTC";

export type RadiusMonth = {
  key: string;
  year: number;
  month: number;
  count: number;
  label: string;
};

export type RadiusListItem = {
  id: string;
  day: string;
  time: string;
  packetType: string;
  callOrigin: string;
  calling: string;
  called: string;
  userName: string;
  srcOut: string;
  dstOut: string;
  inTrunk: string;
  outTrunk: string;
  remoteId: string;
  srcIp: string;
  session: string;
};

export type RadiusGapView = {
  id: string;
  fromOffset: string;
  toOffset: string;
  reason: string;
};

export type ListRadiusResult = {
  items: RadiusListItem[];
  total: number;
  page: number;
  pageSize: number;
  month: string;
  months: RadiusMonth[];
  undatedCount: number;
  gaps: RadiusGapView[];
  configured: boolean;
  lastPassAt: string | null;
  hadCalls: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  timeZone: string;
};

export type RadiusLoadAge = {
  configured: boolean;
  lastPassAt: string | null;
  hadCalls: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
};

const FACET_FIELD: Record<RadiusFacetColumn, keyof Prisma.RadiusCallWhereInput> = {
  packetType: "packetType",
  callOrigin: "callOrigin",
  inTrunk: "inTrunk",
  outTrunk: "outTrunk",
  remoteId: "remoteId",
  srcIp: "srcIp",
};

const PHONE_FIELDS = [
  "callingStationId",
  "calledStationId",
  "userName",
  "srcNumberOut",
  "dstNumberOut",
] as const;

function splitStamp(value: Date | null, timeZone: string): { day: string; time: string } {
  if (!value) return { day: "", time: "" };
  const full = formatDisplayTimestamp(value, timeZone);
  const comma = full.indexOf(", ");
  if (comma < 0) return { day: full, time: "" };
  return { day: full.slice(0, comma), time: full.slice(comma + 2) };
}

function resolveMonth(
  month: string | undefined,
  timeZone: string,
): {
  key: string;
  year: number;
  month: number;
} {
  const parsed = month ? parseMonthKey(month) : null;
  if (parsed) return { key: month!, ...parsed };
  const current = zonedMonth(new Date(), timeZone);
  return current;
}

function buildWhere(
  filters: ColumnFilters,
  phoneQ: string,
  range: { start: Date; end: Date },
): Prisma.RadiusCallWhereInput {
  const parts: Prisma.RadiusCallWhereInput[] = [
    { loggedAt: { gte: range.start, lt: range.end } },
  ];
  for (const [column, values] of Object.entries(filters)) {
    if (!isRadiusFacetColumn(column) || !values?.length) continue;
    const field = FACET_FIELD[column];
    parts.push({
      OR: values.map((value) =>
        value === EMPTY_FILTER_TOKEN ? { [field]: "" } : { [field]: value },
      ),
    });
  }
  const q = phoneQ.trim();
  if (q) {
    parts.push({
      OR: PHONE_FIELDS.map((field) => ({
        [field]: { contains: q, mode: "insensitive" as const },
      })),
    });
  }
  return { AND: parts };
}

async function loadMonths(timeZone: string): Promise<RadiusMonth[]> {
  const rows = await prisma.$queryRaw<Array<{ y: number; m: number; c: bigint }>>(
    Prisma.sql`
      SELECT
        EXTRACT(YEAR FROM ("logged_at" AT TIME ZONE 'UTC'))::int AS y,
        EXTRACT(MONTH FROM ("logged_at" AT TIME ZONE 'UTC'))::int AS m,
        COUNT(*)::bigint AS c
      FROM "radius_calls"
      WHERE "logged_at" IS NOT NULL
      GROUP BY 1, 2
      ORDER BY 1 DESC, 2 DESC
    `,
  );
  const months = rows.map((row) => ({
    key: `${row.y}-${String(row.m).padStart(2, "0")}`,
    year: row.y,
    month: row.m,
    count: Number(row.c),
    label: formatMonthOption(row.y, row.m, Number(row.c)),
  }));
  const current = zonedMonth(new Date(), timeZone);
  if (!months.some((item) => item.key === current.key)) {
    months.unshift({
      ...current,
      count: 0,
      label: formatMonthOption(current.year, current.month, 0),
    });
  }
  return months;
}

function ageFrom(
  state: {
    lastDataAt: Date | null;
    lastDataHadRows: boolean;
    lastCheckedAt: Date | null;
    lastError: string | null;
  } | null,
  configured: boolean,
): RadiusLoadAge {
  return {
    configured,
    lastPassAt: state?.lastDataAt?.toISOString() ?? null,
    hadCalls: state?.lastDataHadRows ?? false,
    lastCheckedAt: state?.lastCheckedAt?.toISOString() ?? null,
    lastError: state?.lastError ?? null,
  };
}

async function parkingKeyConfigured(): Promise<boolean> {
  const row = await prisma.parkingSshSecret.findUnique({
    where: { id: 1 },
    select: { privateKeyCiphertext: true },
  });
  return Boolean(row?.privateKeyCiphertext);
}

export async function getRadiusLoadAge(): Promise<RadiusLoadAge> {
  const [state, configured] = await Promise.all([
    prisma.radiusIngestState.findUnique({ where: { id: 1 } }),
    parkingKeyConfigured(),
  ]);
  return ageFrom(state, configured);
}

async function loadChrome(
  timeZone: string,
): Promise<
  Pick<
    ListRadiusResult,
    | "months"
    | "undatedCount"
    | "gaps"
    | "configured"
    | "lastPassAt"
    | "hadCalls"
    | "lastCheckedAt"
    | "lastError"
    | "timeZone"
  >
> {
  const [months, undatedCount, gaps, state, configured] = await Promise.all([
    loadMonths(timeZone),
    prisma.radiusCall.count({ where: { loggedAt: null } }),
    prisma.radiusIngestGap.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.radiusIngestState.findUnique({ where: { id: 1 } }),
    parkingKeyConfigured(),
  ]);
  return {
    months,
    undatedCount,
    gaps: gaps.map((gap) => ({
      id: gap.id,
      fromOffset: gap.fromOffset.toString(),
      toOffset: gap.toOffset.toString(),
      reason: gap.reason,
    })),
    ...ageFrom(state, configured),
    timeZone,
  };
}

function emptyResult(timeZone: string, month: string): ListRadiusResult {
  const parsed = parseMonthKey(month) ?? zonedMonth(new Date(), timeZone);
  return {
    items: [],
    total: 0,
    page: 1,
    pageSize: TABLE_PAGE_SIZE,
    month,
    months: [
      {
        key: month,
        year: parsed.year,
        month: parsed.month,
        count: 0,
        label: formatMonthOption(parsed.year, parsed.month, 0),
      },
    ],
    undatedCount: 0,
    gaps: [],
    configured: false,
    lastPassAt: null,
    hadCalls: false,
    lastCheckedAt: null,
    lastError: null,
    timeZone,
  };
}

export async function listRadiusCalls(opts: {
  filters?: ColumnFilters;
  phoneQ?: string;
  month?: string;
  timeSort?: TimeSort | null;
  page?: number;
  pageSize?: number;
}): Promise<ListRadiusResult> {
  const timeZone = PAGE_ZONE;
  const month = resolveMonth(opts.month, timeZone);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? TABLE_PAGE_SIZE));
  const page = Math.max(1, opts.page ?? 1);
  const range = zonedMonthRange(month.year, month.month, timeZone);
  const where = buildWhere(opts.filters ?? {}, opts.phoneQ ?? "", range);
  const direction = opts.timeSort === "asc" ? "asc" : "desc";
  const [rows, total, chrome] = await Promise.all([
    prisma.radiusCall.findMany({
      where,
      orderBy: [{ loggedAt: direction }, { byteOffset: direction }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.radiusCall.count({ where }),
    loadChrome(timeZone),
  ]);
  return {
    items: rows.map((row) => {
      const stamp = splitStamp(row.loggedAt, timeZone);
      return {
        id: row.id,
        day: stamp.day,
        time: stamp.time,
        packetType: row.packetType,
        callOrigin: row.callOrigin,
        calling: row.callingStationId,
        called: row.calledStationId,
        userName: row.userName,
        srcOut: row.srcNumberOut,
        dstOut: row.dstNumberOut,
        inTrunk: row.inTrunk,
        outTrunk: row.outTrunk,
        remoteId: row.remoteId,
        srcIp: row.srcIp,
        session: row.acctSessionId,
      };
    }),
    total,
    page,
    pageSize,
    month: month.key,
    ...chrome,
  };
}

export async function listRadiusFacets(opts: {
  column: string;
  filters?: ColumnFilters;
  phoneQ?: string;
  month?: string;
  q?: string;
  limit?: number;
}): Promise<{ items: { value: string; count: number }[]; truncated: boolean }> {
  if (!isRadiusFacetColumn(opts.column)) {
    return { items: [], truncated: false };
  }
  const timeZone = PAGE_ZONE;
  const month = resolveMonth(opts.month, timeZone);
  const range = zonedMonthRange(month.year, month.month, timeZone);
  const filters = { ...(opts.filters ?? {}) };
  delete filters[opts.column];
  const where = buildWhere(filters, opts.phoneQ ?? "", range);
  const field = FACET_FIELD[opts.column];
  const q = opts.q?.trim();
  const scoped: Prisma.RadiusCallWhereInput = q
    ? { AND: [where, { [field]: { contains: q, mode: "insensitive" } }] }
    : where;
  const limit = Math.min(500, Math.max(1, opts.limit ?? 200));
  const grouped = await prisma.radiusCall.groupBy({
    by: [field as Prisma.RadiusCallScalarFieldEnum],
    where: scoped,
    _count: { _all: true },
  });
  const items = grouped
    .map((row) => {
      const value = String(row[field as keyof typeof row] ?? "");
      return {
        value: value === "" ? EMPTY_FILTER_TOKEN : value,
        count: row._count._all,
      };
    })
    .sort((a, b) => b.count - a.count);
  return {
    items: items.slice(0, limit),
    truncated: items.length > limit,
  };
}

export async function loadAntifraudPageInitial(): Promise<{
  initial: ListRadiusResult;
  initialListError: string | null;
}> {
  const timeZone = PAGE_ZONE;
  const month = zonedMonth(new Date(), timeZone).key;
  try {
    const initial = await listRadiusCalls({ month, page: 1, pageSize: TABLE_PAGE_SIZE });
    return { initial, initialListError: null };
  } catch (error) {
    return {
      initial: emptyResult(timeZone, month),
      initialListError:
        error instanceof Error ? error.message : "Не удалось загрузить журнал",
    };
  }
}
