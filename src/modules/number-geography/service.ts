/**
 * Live projection of phone endpoints. No stored geography table.
 */

import {
  aggregateFacetItems,
  type ColumnFilters,
  type FacetResponse,
} from "@/components/column-filters/types";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { EXCEL_MAX_ROWS } from "@/modules/enrich/types";
import {
  isNumberGeographyColumn,
  type NumberGeographyColumn,
} from "@/modules/number-geography/columns";
import { clampPage, clampPageSize } from "@/modules/number-geography/paging";
import {
  blockedCountSql,
  catalogCountSql,
  catalogFacetSql,
  catalogListSql,
  cheapWhere,
  expensiveWhere,
  facetProjection,
  listProjection,
  pageCountSql,
  pageFacetSql,
  pageListSql,
} from "@/modules/number-geography/sql";
import {
  parsePstnLookupStatus,
  type ListNumberGeographyResult,
  type NumberGeographyItem,
  type NumberGeographyRefresh,
} from "@/modules/number-geography/types";

const DEFAULT_REFRESH: NumberGeographyRefresh = {
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
  city: string;
  abc: string;
  telephone: string;
  operator: string;
  geography: string;
  city_alert: boolean | null;
  pstn_status: string | null;
};

type CountRow = { n: number };
type FacetRow = { value: string | null; count: number };

function mapRow(row: DbRow): NumberGeographyItem {
  return {
    id: row.id,
    category: row.category ?? "",
    city: row.city ?? "",
    abc: row.abc ?? "",
    telephone: row.telephone ?? "",
    supplier: row.supplier ?? "",
    number: row.number ?? "",
    client: row.client ?? "",
    capacity: row.capacity ?? "",
    operator: row.operator ?? "",
    geography: row.geography ?? "",
    title: row.title ?? "",
    activation: row.activation ?? "",
    cityAlert: row.city_alert === true,
    pstnStatus: parsePstnLookupStatus(row.pstn_status),
  };
}

function facetsFromGroups(
  rows: FacetRow[],
  opts: { q?: string; limit?: number },
): FacetResponse {
  function* values(): Generator<string> {
    for (const row of rows) {
      const n = Number(row.count) || 0;
      const value = row.value ?? "";
      for (let i = 0; i < n; i++) yield value;
    }
  }
  return aggregateFacetItems(values(), opts);
}

async function readCatalogStamp(): Promise<string> {
  const row = await prisma.phoneEndpoint.aggregate({
    _max: { lastSyncedAt: true },
  });
  return row._max.lastSyncedAt?.toISOString() ?? "";
}

async function readRefresh(): Promise<NumberGeographyRefresh> {
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

export async function listNumberGeography(opts: {
  filters?: ColumnFilters;
  phoneQ?: string;
  blockedOnly?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<ListNumberGeographyResult> {
  const page = clampPage(opts.page ?? 1);
  const pageSize = clampPageSize(opts.pageSize);
  const filters = opts.filters ?? {};
  const phoneQ = opts.phoneQ?.trim() ?? "";
  const blockedOnly = opts.blockedOnly === true;
  const [refresh, catalogStamp, blockedRows] = await Promise.all([
    readRefresh(),
    readCatalogStamp(),
    prisma.$queryRaw<CountRow[]>(blockedCountSql()),
  ]);
  const blockedCount = Number(blockedRows[0]?.n ?? 0);
  const empty: ListNumberGeographyResult = {
    items: [],
    total: 0,
    page,
    pageSize,
    refresh,
    catalogStamp,
    blockedCount,
  };
  const projection = listProjection(filters);
  if (projection === "empty") return empty;

  const offset = (page - 1) * pageSize;
  if (projection === "page") {
    const cheap = cheapWhere(filters, undefined, phoneQ, blockedOnly);
    const [counts, rows] = await Promise.all([
      prisma.$queryRaw<CountRow[]>(pageCountSql(cheap)),
      prisma.$queryRaw<DbRow[]>(pageListSql(cheap, pageSize, offset)),
    ]);
    return {
      items: rows.map(mapRow),
      total: Number(counts[0]?.n ?? 0),
      page,
      pageSize,
      refresh,
      catalogStamp,
      blockedCount,
    };
  }

  const cheap = cheapWhere(filters, undefined, phoneQ, blockedOnly);
  const expensive = expensiveWhere(filters);
  const [counts, rows] = await Promise.all([
    prisma.$queryRaw<CountRow[]>(catalogCountSql(cheap, expensive)),
    prisma.$queryRaw<DbRow[]>(catalogListSql(cheap, expensive, pageSize, offset)),
  ]);
  return {
    items: rows.map(mapRow),
    total: Number(counts[0]?.n ?? 0),
    page,
    pageSize,
    refresh,
    catalogStamp,
    blockedCount,
  };
}

/** Full catalog, one snapshot. Used by the XLSX download. */
export async function listAllNumberGeography(): Promise<NumberGeographyItem[]> {
  const rows = await prisma.$queryRaw<DbRow[]>(
    catalogListSql(Prisma.sql`TRUE`, Prisma.sql`TRUE`, EXCEL_MAX_ROWS + 1, 0),
  );
  if (rows.length > EXCEL_MAX_ROWS) {
    throw new Error("Слишком много строк для одного файла XLSX");
  }
  return rows.map(mapRow);
}

export async function listNumberGeographyFacets(opts: {
  column: string;
  filters?: ColumnFilters;
  phoneQ?: string;
  blockedOnly?: boolean;
  q?: string;
  limit?: number;
}): Promise<FacetResponse> {
  const column = opts.column.trim();
  if (!isNumberGeographyColumn(column)) {
    return { items: [], truncated: false };
  }
  const filters = opts.filters ?? {};
  const phoneQ = opts.phoneQ?.trim() ?? "";
  const blockedOnly = opts.blockedOnly === true;
  const projection = facetProjection(column, filters);
  if (projection === "empty") return { items: [], truncated: false };

  const rows =
    projection === "page"
      ? await prisma.$queryRaw<FacetRow[]>(
          pageFacetSql(column, cheapWhere(filters, column, phoneQ, blockedOnly)),
        )
      : await prisma.$queryRaw<FacetRow[]>(
          catalogFacetSql(
            column,
            cheapWhere(filters, column, phoneQ, blockedOnly),
            expensiveWhere(filters, column),
          ),
        );
  return facetsFromGroups(rows, { q: opts.q, limit: opts.limit });
}

export type { NumberGeographyColumn };
