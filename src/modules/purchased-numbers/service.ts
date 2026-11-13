/**
 * Purchased-number list and facets. Rows come from purchased_numbers.
 * This release does not write rows.
 */

import { cellToFilterToken, type FacetResponse } from "@/components/column-filters/types";
import { prisma } from "@/lib/db";
import type {
  ListPurchasedNumbersResult,
  PurchasedNumberRow,
} from "@/modules/purchased-numbers/format";
import {
  PURCHASED_NUMBERS_EXPORT_BATCH,
  type PurchasedNumbersFacetQuery,
  type PurchasedNumbersListQuery,
} from "@/modules/purchased-numbers/query";
import {
  purchasedNumberCountSql,
  purchasedNumberFacetSql,
  purchasedNumberKeysetSql,
  purchasedNumberListSql,
  purchasedNumberWhere,
  type PurchasedNumberCursor,
} from "@/modules/purchased-numbers/sql";

type DbRow = PurchasedNumberRow;

type CountRow = { count: number | string | null };
type FacetRow = { value: string | null; count: number | string | null };

function toRow(row: DbRow): PurchasedNumberRow {
  return {
    id: row.id ?? "",
    provider: row.provider ?? "",
    abc: row.abc ?? "",
    number: row.number ?? "",
    category: row.category ?? "",
    city: row.city ?? "",
    region: row.region ?? "",
    client: row.client ?? "",
    mask: row.mask ?? "",
    maskType: row.maskType ?? "",
    purchase: row.purchase ?? "",
    premium: row.premium ?? "",
    operator: row.operator ?? "",
    geography: row.geography ?? "",
    e164: row.e164 ?? "",
  };
}

function readCount(value: number | string | null | undefined): number {
  const count = typeof value === "number" ? value : Number(value);
  return Number.isFinite(count) ? count : 0;
}

export async function countPurchasedNumbers(
  filters: PurchasedNumbersListQuery["filters"],
  phoneQ: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<CountRow[]>(
    purchasedNumberCountSql(purchasedNumberWhere(filters, phoneQ)),
  );
  return readCount(rows[0]?.count);
}

export async function listPurchasedNumbers(
  query: PurchasedNumbersListQuery,
): Promise<ListPurchasedNumbersResult> {
  const where = purchasedNumberWhere(query.filters, query.phoneQ);
  const offset = (query.page - 1) * query.pageSize;
  const [counts, rows] = await Promise.all([
    prisma.$queryRaw<CountRow[]>(purchasedNumberCountSql(where)),
    prisma.$queryRaw<DbRow[]>(purchasedNumberListSql(where, query.pageSize, offset)),
  ]);
  return {
    items: rows.map(toRow),
    total: readCount(counts[0]?.count),
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function listPurchasedNumberFacets(
  query: PurchasedNumbersFacetQuery,
): Promise<FacetResponse> {
  const where = purchasedNumberWhere(query.filters, query.phoneQ, query.column);
  const rows = await prisma.$queryRaw<FacetRow[]>(
    purchasedNumberFacetSql(query.column, where, query.q, query.limit + 1),
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
export async function listPurchasedNumbersExportBatch(input: {
  filters: PurchasedNumbersListQuery["filters"];
  phoneQ: string;
  cursor: PurchasedNumberCursor | null;
  limit?: number;
}): Promise<PurchasedNumberRow[]> {
  const limit = input.limit ?? PURCHASED_NUMBERS_EXPORT_BATCH;
  const rows = await prisma.$queryRaw<DbRow[]>(
    purchasedNumberKeysetSql(
      purchasedNumberWhere(input.filters, input.phoneQ),
      input.cursor,
      limit,
    ),
  );
  return rows.map(toRow);
}
