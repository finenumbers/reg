/**
 * Marking catalog — paged list of the current XLSX snapshot.
 */

import type { ColumnFilters, FacetResponse } from "@/components/column-filters/types";
import { prisma } from "@/lib/db";
import {
  applyMarkingQuery,
  isMarkingColumn,
  markingFacets,
} from "@/modules/marking/query-filter";

export type MarkingListItem = {
  id: string;
  client: string;
  phoneNumber: string;
  labelMts: string | null;
  labelMegafon: string | null;
  labelBeeline: string | null;
  labelT2: string | null;
  mavMts: string | null;
  mavMegafon: string | null;
  mavBeeline: string | null;
  mavT2: string | null;
};

export type ListMarkingResult = {
  items: MarkingListItem[];
  total: number;
  page: number;
  pageSize: number;
  loadedAt: string | null;
  filename: string | null;
  rowCount: number;
};

const markingSelect = {
  id: true,
  client: true,
  phoneNumber: true,
  labelMts: true,
  labelMegafon: true,
  labelBeeline: true,
  labelT2: true,
  mavMts: true,
  mavMegafon: true,
  mavBeeline: true,
  mavT2: true,
} as const;

async function loadMarkingSnapshot(): Promise<MarkingListItem[]> {
  return prisma.markingRow.findMany({
    orderBy: { sortIndex: "asc" },
    select: markingSelect,
  });
}

/**
 * Reads the whole snapshot, then slices the filtered rows.
 * `total` is the filtered count. `rowCount` stays the snapshot size.
 */
export async function listMarkingRows(opts: {
  page?: number;
  pageSize?: number;
  filters?: ColumnFilters;
}): Promise<ListMarkingResult> {
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 100));
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const skip = (page - 1) * pageSize;

  const [state, rows] = await Promise.all([
    prisma.markingImportState.findUnique({ where: { id: 1 } }),
    loadMarkingSnapshot(),
  ]);
  const filtered = applyMarkingQuery(rows, { filters: opts.filters });

  return {
    items: filtered.slice(skip, skip + pageSize),
    total: filtered.length,
    page,
    pageSize,
    loadedAt: state?.loadedAt?.toISOString() ?? null,
    filename: state?.filename ?? null,
    rowCount: state?.rowCount ?? rows.length,
  };
}

export async function listMarkingFacets(opts: {
  column: string;
  filters?: ColumnFilters;
  q?: string;
  limit?: number;
}): Promise<FacetResponse> {
  if (!isMarkingColumn(opts.column)) return { items: [], truncated: false };
  const rows = await loadMarkingSnapshot();
  return markingFacets(rows, opts);
}
