/**
 * Tariff catalog — paged list of the current XLSX snapshot.
 */

import type { ColumnFilters, FacetResponse } from "@/components/column-filters/types";
import { prisma } from "@/lib/db";
import { formatTariffDecimal, parseStoredNumbering } from "@/modules/tariffs/parse-xlsx";
import { applyTariffQuery, isTariffColumn, tariffFacets } from "@/modules/tariffs/query-filter";
import type { TariffRateLookup } from "@/modules/traffic/cdr-tariff";
import { parseStoredDigitLengths } from "@/modules/traffic/tariff-match";

export type TariffListItem = {
  id: string;
  direction: string;
  abc: string;
  digitLengths: number[] | null;
  numbering: number[] | null;
  region: string | null;
  price: string;
};

export type ListTariffsResult = {
  items: TariffListItem[];
  total: number;
  page: number;
  pageSize: number;
  loadedAt: string | null;
  filename: string | null;
  rowCount: number;
};

/** Full snapshot for CDR rating. Not paged. */
export async function loadTariffRateLookup(): Promise<TariffRateLookup[]> {
  const rows = await prisma.tariffRate.findMany({
    orderBy: { sortIndex: "asc" },
    select: {
      direction: true,
      abc: true,
      digitLengths: true,
      price: true,
      sortIndex: true,
    },
  });
  return rows.map((row) => ({
    direction: row.direction,
    abc: row.abc,
    digitLengths: parseStoredDigitLengths(row.digitLengths),
    price: formatTariffDecimal(row.price.toString()),
    sortIndex: row.sortIndex,
  }));
}

const tariffSelect = {
  id: true,
  direction: true,
  abc: true,
  digitLengths: true,
  numbering: true,
  region: true,
  price: true,
} as const;

function toTariffListItem(row: {
  id: string;
  direction: string;
  abc: string;
  digitLengths: string | null;
  numbering: string | null;
  region: string | null;
  price: { toString(): string };
}): TariffListItem {
  return {
    id: row.id,
    direction: row.direction,
    abc: row.abc,
    digitLengths: parseStoredDigitLengths(row.digitLengths),
    numbering: parseStoredNumbering(row.numbering),
    region: row.region,
    price: formatTariffDecimal(row.price.toString()),
  };
}

async function loadTariffSnapshot(): Promise<TariffListItem[]> {
  const rows = await prisma.tariffRate.findMany({
    orderBy: { sortIndex: "asc" },
    select: tariffSelect,
  });
  return rows.map(toTariffListItem);
}

/**
 * Reads the whole snapshot, then slices the filtered rows.
 * `total` is the filtered count. `rowCount` stays the snapshot size.
 * Export does not use this list and still writes the full snapshot.
 */
export async function listTariffRates(opts: {
  page?: number;
  pageSize?: number;
  filters?: ColumnFilters;
}): Promise<ListTariffsResult> {
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 100));
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const skip = (page - 1) * pageSize;

  const [state, items] = await Promise.all([
    prisma.tariffImportState.findUnique({ where: { id: 1 } }),
    loadTariffSnapshot(),
  ]);
  const filtered = applyTariffQuery(items, { filters: opts.filters });

  return {
    items: filtered.slice(skip, skip + pageSize),
    total: filtered.length,
    page,
    pageSize,
    loadedAt: state?.loadedAt?.toISOString() ?? null,
    filename: state?.filename ?? null,
    rowCount: state?.rowCount ?? items.length,
  };
}

export async function listTariffFacets(opts: {
  column: string;
  filters?: ColumnFilters;
  q?: string;
  limit?: number;
}): Promise<FacetResponse> {
  if (!isTariffColumn(opts.column)) return { items: [], truncated: false };
  const items = await loadTariffSnapshot();
  return tariffFacets(items, opts);
}
