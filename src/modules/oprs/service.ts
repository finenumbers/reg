/**
 * OPRS list. One open view is one importedAt snapshot, walked by keyset.
 */

import { Prisma } from "@/generated/prisma/client";
import {
  toFilterToken,
  type FacetResponse,
} from "@/components/column-filters/types";
import { prisma } from "@/lib/db";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import { cdrHasBlockedNumber } from "@/modules/traffic/blocked-number";
import { loadBlockedNumbers } from "@/modules/phones/blocked-numbers";
import {
  CDR_VACUUM_BUSY_MESSAGE,
  isDatabaseVacuumActive,
} from "@/modules/storage/vacuum/gate";
import {
  currentUtcMonth,
  resolveMonthKey,
  type CdrMonth,
} from "@/modules/traffic/cdr-month";
import { listCachedMonthCounts } from "@/modules/traffic/cdr-month-stats";
import {
  csvHeaderToCamel,
  isTrafficColumn,
  OPRS_COLUMNS,
} from "@/modules/traffic/columns";
import { facetSearchWhere } from "@/modules/traffic/service";
import type { ListTrafficResult, TrafficListItem } from "@/modules/traffic/service";
import {
  arrangeTrafficFacetItems,
  trafficFacetGroupOrder,
  trafficListOrderBy,
} from "@/modules/traffic/traffic-sort";
import type { OprsListInput } from "@/modules/oprs/query";
import { OPRS_LIST_SELECT, oprsRowData, type OprsListRow } from "@/modules/oprs/row";
import { withOprsTimeout } from "@/modules/oprs/timeout";
import { buildOprsWhere, resolveOprsSnapshot } from "@/modules/oprs/where";

const FACET_COLUMNS = new Set<string>(
  OPRS_COLUMNS.filter((column) => isTrafficColumn(column)),
);

export type OprsListResult = ListTrafficResult & {
  /** False on a keyset page: the client keeps the snapshot total. */
  counted: boolean;
  snapshot: string;
  /** The page came back full, so another keyset page may exist. */
  full: boolean;
};

function monthsWithoutCounts(months: readonly CdrMonth[]): CdrMonth[] {
  return months.map(({ year, month, key }) => ({ year, month, key }));
}

async function readGuiUrl(): Promise<string> {
  const setting = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: { voipmonitorGuiUrl: true },
  });
  return setting?.voipmonitorGuiUrl?.trim() ?? "";
}

async function mapRows(rows: OprsListRow[]): Promise<TrafficListItem[]> {
  if (rows.length === 0) return [];
  const [links, guiUrl, blockedNumbers] = await Promise.all([
    prisma.cdrVoipmonitorLink.findMany({
      where: { cdrRecordId: { in: rows.map((row) => row.id) } },
      select: { cdrRecordId: true, voipmonitorLegs: true },
    }),
    readGuiUrl(),
    loadBlockedNumbers(),
  ]);
  const linkById = new Map(links.map((link) => [link.cdrRecordId, link]));
  return rows.map((row) => ({
    id: row.id,
    cdrAt: row.cdrAt?.toISOString() ?? null,
    data: oprsRowData(row, linkById.get(row.id), guiUrl),
    ...(cdrHasBlockedNumber(blockedNumbers, row) ? { blocked: true } : {}),
  }));
}

async function readSnapshotPage(
  where: Prisma.CdrRecordWhereInput,
  orderBy: Prisma.CdrRecordOrderByWithRelationInput[],
  pageSize: number,
): Promise<{ total: number; rows: OprsListRow[] }> {
  return withOprsTimeout(async (tx) => {
    const total = await tx.cdrRecord.count({ where });
    const rows = await tx.cdrRecord.findMany({
      where,
      orderBy,
      take: pageSize,
      select: OPRS_LIST_SELECT,
    });
    return { total, rows };
  }, Prisma.TransactionIsolationLevel.RepeatableRead);
}

export async function listOprs(
  input: OprsListInput,
  now = new Date(),
): Promise<OprsListResult> {
  const pageSize = Math.min(200, Math.max(1, input.pageSize));
  const month = resolveMonthKey(input.month, now);
  const snapshot = input.cursor
    ? resolveOprsSnapshot(input.snapshotRaw, now)
    : now;
  const where = buildOprsWhere({
    year: month.year,
    month: month.month,
    filters: input.filters,
    phoneQ: input.phoneQ,
    flags: input.flags,
    snapshot,
    cursor: input.cursor,
    timeSort: input.timeSort,
  });
  const orderBy = trafficListOrderBy(input.timeSort);
  const counted = input.cursor == null;
  const page = counted
    ? await readSnapshotPage(where, orderBy, pageSize)
    : {
        total: 0,
        rows: await withOprsTimeout((tx) =>
          tx.cdrRecord.findMany({
            where,
            orderBy,
            take: pageSize,
            select: OPRS_LIST_SELECT,
          }),
        ),
      };
  const [items, months] = await Promise.all([
    mapRows(page.rows),
    counted
      ? listCachedMonthCounts(now.getTime()).then(monthsWithoutCounts)
      : Promise.resolve(undefined),
  ]);
  return {
    items,
    headers: [...OPRS_COLUMNS],
    total: page.total,
    counted,
    page: 1,
    pageSize,
    month: month.key,
    months,
    snapshot: snapshot.toISOString(),
    full: page.rows.length === pageSize,
  };
}

export async function loadOprsPageInitial(
  now = new Date(),
): Promise<{ initial: OprsListResult; initialListError: string | null }> {
  if (isDatabaseVacuumActive()) {
    const month = currentUtcMonth(now);
    return {
      initial: {
        items: [],
        headers: [...OPRS_COLUMNS],
        total: 0,
        counted: true,
        page: 1,
        pageSize: TABLE_PAGE_SIZE,
        month: month.key,
        months: [{ year: month.year, month: month.month, key: month.key }],
        snapshot: now.toISOString(),
        full: false,
      },
      initialListError: CDR_VACUUM_BUSY_MESSAGE,
    };
  }
  return {
    initial: await listOprs(
      {
        filters: {},
        phoneQ: "",
        flags: {},
        timeSort: null,
        cursor: null,
        snapshotRaw: null,
        pageSize: TABLE_PAGE_SIZE,
      },
      now,
    ),
    initialListError: null,
  };
}

export function isOprsFacetColumn(column: string): boolean {
  return FACET_COLUMNS.has(column);
}

export async function listOprsFacets(
  input: OprsListInput & { column: string; q: string; limit: number },
  now = new Date(),
): Promise<FacetResponse> {
  const column = input.column.trim();
  if (!isOprsFacetColumn(column)) return { items: [], truncated: false };
  const snapshot = resolveOprsSnapshot(input.snapshotRaw, now);
  const month = resolveMonthKey(input.month, now);
  const limit = Math.min(500, Math.max(1, input.limit));
  const field = csvHeaderToCamel(column);
  const where = buildOprsWhere({
    year: month.year,
    month: month.month,
    filters: input.filters,
    phoneQ: input.phoneQ,
    flags: input.flags,
    snapshot,
    cursor: null,
    timeSort: null,
    excludeColumn: column,
  });
  const fieldWhere: Prisma.CdrRecordWhereInput = input.q
    ? { AND: [where, facetSearchWhere(field, column, input.q)] }
    : where;
  const grouped = await withOprsTimeout((tx) =>
    tx.cdrRecord.groupBy({
      by: [field as Prisma.CdrRecordScalarFieldEnum],
      where: fieldWhere,
      _count: true,
      orderBy: trafficFacetGroupOrder(column),
      take: limit + 1,
    }),
  );
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
