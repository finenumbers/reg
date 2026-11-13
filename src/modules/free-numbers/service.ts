/**
 * Free-number list and facets. Rows come from free_numbers.
 */

import { cellToFilterToken, type FacetResponse } from "@/components/column-filters/types";
import { prisma } from "@/lib/db";
import type { FreeNumberRow, ListFreeNumbersResult } from "@/modules/free-numbers/format";
import {
  FREE_NUMBERS_EXPORT_BATCH,
  type FreeNumbersFacetQuery,
  type FreeNumbersListQuery,
} from "@/modules/free-numbers/query";
import {
  freeNumberCountSql,
  freeNumberFacetSql,
  freeNumberKeysetSql,
  freeNumberListSql,
  freeNumberWhere,
  type FreeNumberCursor,
} from "@/modules/free-numbers/sql";

type DbRow = FreeNumberRow;

type CountRow = { count: number | string | null };
type FacetRow = { value: string | null; count: number | string | null };

function toRow(row: DbRow): FreeNumberRow {
  return {
    id: row.id ?? "",
    provider: row.provider ?? "",
    abc: row.abc ?? "",
    number: row.number ?? "",
    category: row.category ?? "",
    city: row.city ?? "",
    region: row.region ?? "",
    mask: row.mask ?? "",
    maskType: row.maskType ?? "",
    incomingPurchase: row.incomingPurchase ?? "",
    incomingPeriod: row.incomingPeriod ?? "",
    purchase: row.purchase ?? "",
    premium: row.premium ?? "",
    operator: row.operator ?? "",
    geography: row.geography ?? "",
  };
}

function readCount(value: number | string | null | undefined): number {
  const count = typeof value === "number" ? value : Number(value);
  return Number.isFinite(count) ? count : 0;
}

export async function countFreeNumbers(
  filters: FreeNumbersListQuery["filters"],
  phoneQ: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<CountRow[]>(
    freeNumberCountSql(freeNumberWhere(filters, phoneQ)),
  );
  return readCount(rows[0]?.count);
}

export async function listFreeNumbers(
  query: FreeNumbersListQuery,
): Promise<ListFreeNumbersResult> {
  const where = freeNumberWhere(query.filters, query.phoneQ);
  const offset = (query.page - 1) * query.pageSize;
  const [counts, rows] = await Promise.all([
    prisma.$queryRaw<CountRow[]>(freeNumberCountSql(where)),
    prisma.$queryRaw<DbRow[]>(freeNumberListSql(where, query.pageSize, offset)),
  ]);
  return {
    items: rows.map(toRow),
    total: readCount(counts[0]?.count),
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function listFreeNumberFacets(
  query: FreeNumbersFacetQuery,
): Promise<FacetResponse> {
  const where = freeNumberWhere(query.filters, query.phoneQ, query.column);
  const rows = await prisma.$queryRaw<FacetRow[]>(
    freeNumberFacetSql(query.column, where, query.q, query.limit + 1),
  );
  const truncated = rows.length > query.limit;
  return {
    items: rows.slice(0, query.limit).map((row) => ({
      value: cellToFilterToken(row.value),
      count: readCount(row.count),
    })),
    truncated,
  };
}

/** One keyset page of the filtered catalog, in screen order. */
export async function listFreeNumbersExportBatch(input: {
  filters: FreeNumbersListQuery["filters"];
  phoneQ: string;
  cursor: FreeNumberCursor | null;
  limit?: number;
}): Promise<FreeNumberRow[]> {
  const limit = input.limit ?? FREE_NUMBERS_EXPORT_BATCH;
  const rows = await prisma.$queryRaw<DbRow[]>(
    freeNumberKeysetSql(freeNumberWhere(input.filters, input.phoneQ), input.cursor, limit),
  );
  return rows.map(toRow);
}
