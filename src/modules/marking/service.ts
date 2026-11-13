/**
 * Marking list. Rows are the live RTU working set plus stored labels.
 * One statement returns the page and its total.
 */

import type { ColumnFilters, FacetResponse } from "@/components/column-filters/types";
import {
  isMarkingColumn,
  markingFacetGroups,
  type MarkingColumnId,
} from "@/modules/marking/query-filter";
import { markingFacetSql, markingFilterSql, markingListSql } from "@/modules/marking/sql";
import {
  MARKING_LIST_TIMEOUT,
  markingReadHttpError,
  withMarkingTimeout,
} from "@/modules/marking/timeout";
import { readRtuScreenGate, requestRtuScreenPublish } from "@/modules/rtu/screen-publish";

export type MarkingListItem = {
  id: string;
  client: string;
  supplier: string;
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
  /** Unfiltered working-set size. Import state does not own this count. */
  rowCount: number;
  catalogStamp: string;
  preparing: boolean;
};

const LIST_TX_MS = 20_000;
const MAX_PAGE = 200;

type ListQueryRow = {
  number: string | null;
  client: string | null;
  supplier: string | null;
  label_mts: string | null;
  label_megafon: string | null;
  label_beeline: string | null;
  label_t2: string | null;
  mav_mts: string | null;
  mav_megafon: string | null;
  mav_beeline: string | null;
  mav_t2: string | null;
  n: number | null;
  working_n: number | null;
  catalog_revision: number | null;
  filename: string | null;
  loaded_at: Date | null;
};

type FacetQueryRow = {
  value: string | null;
  count: number | null;
};

function preparingResult(pageSize: number): ListMarkingResult {
  return {
    items: [],
    total: 0,
    page: 1,
    pageSize,
    loadedAt: null,
    filename: null,
    rowCount: 0,
    catalogStamp: "0",
    preparing: true,
  };
}

function clampPageSize(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 100;
  return Math.min(MAX_PAGE, Math.max(1, Math.floor(value)));
}

export class MarkingQueryError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "MarkingQueryError";
  }
}

function cleanCursor(value: string | null | undefined): string | null {
  const cursor = value?.trim() ?? "";
  if (!cursor) return null;
  if (cursor.length > 200) {
    throw new MarkingQueryError("Некорректный курсор");
  }
  return cursor;
}

export async function listMarkingRows(opts: {
  pageSize?: number;
  filters?: ColumnFilters;
  cursor?: string | null;
}): Promise<ListMarkingResult> {
  const pageSize = clampPageSize(opts.pageSize);
  const gate = await readRtuScreenGate();
  if (!gate?.published || gate.needsPublish) {
    void requestRtuScreenPublish();
  }
  if (!gate?.published) return preparingResult(pageSize);

  const rows = await withMarkingTimeout(MARKING_LIST_TIMEOUT, LIST_TX_MS, (tx) =>
    tx.$queryRaw<ListQueryRow[]>(
      markingListSql({
        where: markingFilterSql(opts.filters),
        cursor: cleanCursor(opts.cursor),
        limit: pageSize,
      }),
    ),
  );
  return mapList(rows, pageSize);
}

export async function listMarkingFacets(opts: {
  column: string;
  filters?: ColumnFilters;
  q?: string;
  limit?: number;
}): Promise<FacetResponse> {
  if (!isMarkingColumn(opts.column)) return { items: [], truncated: false };
  const gate = await readRtuScreenGate();
  if (!gate?.published || gate.needsPublish) {
    void requestRtuScreenPublish();
  }
  if (!gate?.published) return { items: [], truncated: false };
  const column: MarkingColumnId = opts.column;
  const rows = await withMarkingTimeout(MARKING_LIST_TIMEOUT, LIST_TX_MS, (tx) =>
    tx.$queryRaw<FacetQueryRow[]>(
      markingFacetSql(column, markingFilterSql(opts.filters, column)),
    ),
  );
  return markingFacetGroups(
    rows.map((row) => ({ value: row.value, count: Number(row.count) || 0 })),
    { q: opts.q, limit: opts.limit },
  );
}

export function mapMarkingReadError(error: unknown): { status: number; error: string } | null {
  if (error instanceof MarkingQueryError) {
    return { status: error.status, error: error.message };
  }
  const mapped = markingReadHttpError(error);
  if (!mapped) return null;
  return { status: mapped.status, error: mapped.error };
}

function mapList(rows: ListQueryRow[], pageSize: number): ListMarkingResult {
  const head = rows[0];
  const items = rows.flatMap((row) => (row.number ? [mapItem(row)] : []));
  return {
    items,
    total: Number(head?.n ?? 0),
    page: 1,
    pageSize,
    loadedAt: head?.loaded_at ? new Date(head.loaded_at).toISOString() : null,
    filename: head?.filename ?? null,
    rowCount: Number(head?.working_n ?? 0),
    catalogStamp: String(Number(head?.catalog_revision ?? 0) || 0),
    preparing: false,
  };
}

function mapItem(row: ListQueryRow): MarkingListItem {
  const phone = row.number ?? "";
  return {
    id: phone,
    client: row.client ?? "",
    supplier: row.supplier ?? "",
    phoneNumber: phone,
    labelMts: row.label_mts,
    labelMegafon: row.label_megafon,
    labelBeeline: row.label_beeline,
    labelT2: row.label_t2,
    mavMts: row.mav_mts,
    mavMegafon: row.mav_megafon,
    mavBeeline: row.mav_beeline,
    mavT2: row.mav_t2,
  };
}
