/**
 * «Управление РТУ» reads the published screen.
 * Unregistered status, operator, and geography stay live for the page.
 */

import {
  cellToFilterToken,
  displayFacetValue,
  type ColumnFilters,
  type FacetResponse,
} from "@/components/column-filters/types";
import { Prisma } from "@/generated/prisma/client";
import { amountFacetQueryHits } from "@/lib/amount-format";
import { prisma } from "@/lib/db";
import { kickGeographyDidRefresh } from "@/modules/rtu/did-snapshot";
import { EXCEL_MAX_ROWS } from "@/modules/enrich/types";
import { isRtuColumn, type RtuColumn } from "@/modules/rtu/columns";
import { clampPage, clampPageSize } from "@/modules/rtu/paging";
import { readRtuScreenGate, requestRtuScreenPublish } from "@/modules/rtu/screen-publish";
import {
  cheapWhere,
  expensiveWhere,
  facetProjection,
  listProjection,
  screenFacetSql,
  screenListSql,
  type CheapFlags,
} from "@/modules/rtu/sql";
import {
  parsePstnLookupStatus,
  type ListRtuResult,
  type RtuItem,
  type RtuRefresh,
} from "@/modules/rtu/types";

const DEFAULT_REFRESH: RtuRefresh = {
  enabled: true,
  intervalSec: 60,
};

type DbRow = {
  id: string;
  number: string;
  client: string;
  capacity: string;
  supplier: string;
  category: string;
  title: string;
  activation: string | null;
  source: string | null;
  missing: boolean | null;
  unregistered: boolean | null;
  city: string;
  region: string;
  abc: string;
  telephone: string;
  mask: string;
  mask_type: string;
  purchase: string;
  premium: string;
  operator: string;
  geography: string;
  city_alert: boolean | null;
  pstn_status: string | null;
};

type FacetRow = { value: string | null; count: number };
type ListQueryRow = Omit<DbRow, "id"> & {
  id: string | null;
  n: number | null;
  blocked: number | null;
  unregistered_count: number | null;
  missing_count: number | null;
  catalog_revision: number | null;
};

function listFlags(opts: {
  blockedOnly?: boolean;
  unregisteredOnly?: boolean;
  missingOnly?: boolean;
}): CheapFlags {
  return {
    blockedOnly: opts.blockedOnly === true,
    unregisteredOnly: opts.unregisteredOnly === true,
    missingOnly: opts.missingOnly === true,
  };
}

function mapRow(row: DbRow): RtuItem {
  return {
    id: row.id,
    category: row.category ?? "",
    city: row.city ?? "",
    region: row.region ?? "",
    abc: row.abc ?? "",
    telephone: row.telephone ?? "",
    supplier: row.supplier ?? "",
    number: row.number ?? "",
    client: row.client ?? "",
    capacity: row.capacity ?? "",
    mask: row.mask ?? "",
    maskType: row.mask_type ?? "",
    purchase: row.purchase ?? "",
    premium: row.premium ?? "",
    operator: row.operator ?? "",
    geography: row.geography ?? "",
    title: row.title ?? "",
    activation: row.activation ?? "",
    source: row.source ?? "",
    cityAlert: row.city_alert === true,
    missing: row.missing === true,
    unregistered: row.unregistered === true,
    pstnStatus: parsePstnLookupStatus(row.pstn_status),
  };
}

function facetsFromGroups(
  rows: FacetRow[],
  opts: {
    q?: string;
    limit?: number;
    matches?: (value: string, query: string) => boolean;
  },
): FacetResponse {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 200));
  const q = opts.q?.trim().toLowerCase() ?? "";
  const counts = new Map<string, number>();
  for (const row of rows) {
    const token = cellToFilterToken(row.value ?? "");
    counts.set(token, (counts.get(token) ?? 0) + (Number(row.count) || 0));
  }
  let items = [...counts.entries()].map(([value, count]) => ({ value, count }));
  items.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return displayFacetValue(a.value).localeCompare(displayFacetValue(b.value), "ru");
  });
  if (q) {
    items = items.filter((item) =>
      opts.matches
        ? opts.matches(item.value, q)
        : displayFacetValue(item.value).toLowerCase().includes(q),
    );
  }
  const truncated = items.length > limit;
  return { items: truncated ? items.slice(0, limit) : items, truncated };
}

async function readRefresh(): Promise<RtuRefresh> {
  const row = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: {
      numberGeographyRefreshEnabled: true,
      numberGeographyRefreshIntervalSec: true,
    },
  });
  if (!row) return DEFAULT_REFRESH;
  const interval = row.numberGeographyRefreshIntervalSec;
  return {
    enabled: row.numberGeographyRefreshEnabled,
    intervalSec:
      Number.isFinite(interval) && interval >= 30 && interval <= 86400
        ? interval
        : DEFAULT_REFRESH.intervalSec,
  };
}

function preparingResult(
  page: number,
  pageSize: number,
  refresh: RtuRefresh,
): ListRtuResult {
  return {
    items: [],
    total: 0,
    page,
    pageSize,
    refresh,
    catalogStamp: "0",
    blockedCount: 0,
    unregisteredCount: 0,
    missingCount: 0,
    preparing: true,
  };
}

function cursorPair(
  number: string | undefined,
  id: string | undefined,
): { number: string; id: string } | null {
  const trimmedNumber = number?.trim() ?? "";
  const trimmedId = id?.trim() ?? "";
  if (!trimmedNumber || !trimmedId) return null;
  return { number: trimmedNumber, id: trimmedId };
}

function screenWhere(
  joined: boolean,
  filters: ColumnFilters,
  exclude: RtuColumn | undefined,
  phoneQ: string,
  flags: CheapFlags,
): Prisma.Sql {
  const cheap = cheapWhere(filters, exclude, phoneQ, flags);
  if (!joined) return cheap;
  return Prisma.sql`(${cheap} AND ${expensiveWhere(filters, exclude)})`;
}

function itemsFrom(rows: ListQueryRow[]): RtuItem[] {
  return rows.flatMap((row) => (row.id == null ? [] : [mapRow({ ...row, id: row.id })]));
}

export async function listRtu(opts: {
  filters?: ColumnFilters;
  phoneQ?: string;
  blockedOnly?: boolean;
  unregisteredOnly?: boolean;
  missingOnly?: boolean;
  page?: number;
  pageSize?: number;
  cursorNumber?: string;
  cursorId?: string;
}): Promise<ListRtuResult> {
  const page = clampPage(opts.page ?? 1);
  const pageSize = clampPageSize(opts.pageSize);
  const filters = opts.filters ?? {};
  const phoneQ = opts.phoneQ?.trim() ?? "";
  const flags = listFlags(opts);
  const cursor = cursorPair(opts.cursorNumber, opts.cursorId);
  kickGeographyDidRefresh();
  const [refresh, gate] = await Promise.all([readRefresh(), readRtuScreenGate()]);
  if (!gate?.published || gate.needsPublish) {
    void requestRtuScreenPublish();
  }
  if (!gate?.published) return preparingResult(page, pageSize, refresh);

  const projection = listProjection(filters);
  if (projection === "empty") {
    return {
      ...preparingResult(page, pageSize, refresh),
      preparing: false,
      catalogStamp: String(gate.catalogRevision),
    };
  }
  const joined = projection === "catalog" || flags.unregisteredOnly === true;
  const rows = await prisma.$queryRaw<ListQueryRow[]>(
    screenListSql({
      joined,
      where: screenWhere(joined, filters, undefined, phoneQ, flags),
      cursorNumber: cursor?.number,
      cursorId: cursor?.id,
      limit: pageSize,
      offset: cursor ? 0 : (page - 1) * pageSize,
    }),
  );
  const head = rows[0];
  return {
    items: itemsFrom(rows),
    total: Number(head?.n ?? 0),
    page,
    pageSize,
    refresh,
    catalogStamp: String(Number(head?.catalog_revision ?? gate.catalogRevision) || 0),
    blockedCount: Number(head?.blocked ?? 0),
    unregisteredCount: Number(head?.unregistered_count ?? 0),
    missingCount: Number(head?.missing_count ?? 0),
    preparing: false,
  };
}

/** Full catalog, one snapshot. Used by the XLSX download. */
export async function listAllRtu(): Promise<RtuItem[]> {
  kickGeographyDidRefresh();
  const gate = await readRtuScreenGate();
  if (!gate?.published) {
    void requestRtuScreenPublish();
    throw new Error("Каталог готовится");
  }
  const rows = await prisma.$queryRaw<ListQueryRow[]>(
    screenListSql({
      joined: true,
      where: Prisma.sql`TRUE`,
      limit: EXCEL_MAX_ROWS + 1,
      offset: 0,
    }),
  );
  const items = itemsFrom(rows);
  if (items.length > EXCEL_MAX_ROWS) {
    throw new Error("Слишком много строк для одного файла XLSX");
  }
  return items;
}

export async function listRtuFacets(opts: {
  column: string;
  filters?: ColumnFilters;
  phoneQ?: string;
  blockedOnly?: boolean;
  unregisteredOnly?: boolean;
  missingOnly?: boolean;
  q?: string;
  limit?: number;
}): Promise<FacetResponse> {
  const column = opts.column.trim();
  kickGeographyDidRefresh();
  if (!isRtuColumn(column)) {
    return { items: [], truncated: false };
  }
  const gate = await readRtuScreenGate();
  if (!gate?.published) {
    void requestRtuScreenPublish();
    return { items: [], truncated: false };
  }
  const filters = opts.filters ?? {};
  const phoneQ = opts.phoneQ?.trim() ?? "";
  const flags = listFlags(opts);
  const projection = facetProjection(column, filters);
  if (projection === "empty") return { items: [], truncated: false };
  const joined = projection === "catalog" || flags.unregisteredOnly === true;
  const rows = await prisma.$queryRaw<FacetRow[]>(
    screenFacetSql(column, screenWhere(joined, filters, column, phoneQ, flags), joined),
  );
  const amount = column === "purchase" || column === "premium";
  return facetsFromGroups(rows, {
    q: opts.q,
    limit: opts.limit,
    matches: amount ? amountFacetQueryHits : undefined,
  });
}

export type { RtuColumn };
