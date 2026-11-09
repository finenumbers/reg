/**
 * Mask catalog — paged list of the current XLSX snapshot.
 */

import type { ColumnFilters, FacetResponse } from "@/components/column-filters/types";
import { prisma } from "@/lib/db";
import { applyMaskQuery, isMaskColumn, maskFacets } from "@/modules/masks/query-filter";

export type MaskListItem = {
  id: string;
  digitLength: number;
  category: string;
  abc: string | null;
  mask: string;
  maskType: string | null;
  premium: string | null;
  purchase: string | null;
};

export type ListMasksResult = {
  items: MaskListItem[];
  total: number;
  page: number;
  pageSize: number;
  loadedAt: string | null;
  filename: string | null;
  rowCount: number;
};

const maskSelect = {
  id: true,
  digitLength: true,
  category: true,
  abc: true,
  mask: true,
  maskType: true,
  premium: true,
  purchase: true,
} as const;

async function loadMaskSnapshot(): Promise<MaskListItem[]> {
  return prisma.numberMask.findMany({
    orderBy: { sortIndex: "asc" },
    select: maskSelect,
  });
}

/**
 * Reads the whole snapshot, then slices the filtered rows.
 * `total` is the filtered count. `rowCount` stays the snapshot size.
 */
export async function listNumberMasks(opts: {
  page?: number;
  pageSize?: number;
  filters?: ColumnFilters;
}): Promise<ListMasksResult> {
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 100));
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const skip = (page - 1) * pageSize;

  const [state, rows] = await Promise.all([
    prisma.numberMaskImportState.findUnique({ where: { id: 1 } }),
    loadMaskSnapshot(),
  ]);
  const filtered = applyMaskQuery(rows, { filters: opts.filters });

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

export async function listMaskFacets(opts: {
  column: string;
  filters?: ColumnFilters;
  q?: string;
  limit?: number;
}): Promise<FacetResponse> {
  if (!isMaskColumn(opts.column)) return { items: [], truncated: false };
  const rows = await loadMaskSnapshot();
  return maskFacets(rows, opts);
}
