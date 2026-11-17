/**
 * PSTN ranges of one operator. The INN is a literal. A foreign row fails the walk.
 */

import { admitRange, addCapacity, FINENUMBERS_INN } from "@/modules/finenumbers/expand";
import { readAllPages, readRangePage, TOTAL_CHANGED, type PageRead } from "@/modules/finenumbers/pages";
import {
  EMPTY_NUMBERING_FILTERS,
  NUMBERING_EXPORT_PAGE_SIZE,
} from "@/modules/numbering-resource/filters";
import { pstnTurn } from "@/modules/numbering-resource/turn";
import {
  listNumberingResource,
  summarizeNumberingResource,
} from "@/modules/numbering-resource/service";
import type { NumberingRow, NumberingSummary } from "@/modules/numbering-resource/types";

export const PHONES_NOT_READY = "Телефонные номера ещё не загружены. Каталог не изменён.";

export type AcceptedRange = {
  id: number;
  abc: string;
  rangeStart: number;
  rangeEnd: number;
  capacity: number;
  operator: string;
  geography: string;
};

export type InnRead =
  | { ok: true; ranges: AcceptedRange[]; capacity: number }
  | { ok: false; error: string };

type ListPage = {
  items: NumberingRow[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
};

function accept(row: NumberingRow): { kind: "keep" } | { kind: "fail"; error: string } {
  const error = admitRange({
    abc: row.abc,
    rangeStart: row.rangeStart,
    rangeEnd: row.rangeEnd,
    capacity: row.capacity,
    inn: row.inn,
  });
  return error ? { kind: "fail", error } : { kind: "keep" };
}

function keptRange(row: NumberingRow): AcceptedRange {
  return {
    id: row.id,
    abc: row.abc,
    rangeStart: row.rangeStart,
    rangeEnd: row.rangeEnd,
    capacity: row.capacity,
    operator: row.operator.trim(),
    geography: row.garTerritory.trim(),
  };
}

function summaryAgrees(summary: NumberingSummary, ranges: readonly AcceptedRange[]): boolean {
  if (summary.filtered.totalCapacityPending) return false;
  if (summary.filtered.rangeCount !== ranges.length) return false;
  let capacity = 0;
  for (const range of ranges) capacity = addCapacity(capacity, range.capacity);
  return summary.filtered.totalCapacity === capacity;
}

export async function readInnRanges(input: {
  list?: (cursor: string | null) => Promise<ListPage>;
  summary?: () => Promise<NumberingSummary>;
  onProgress?: (seen: number, total: number) => Promise<void>;
}): Promise<InnRead> {
  const list =
    input.list ??
    ((cursor: string | null) =>
      pstnTurn(() =>
        listNumberingResource({
          cursor,
          pageSize: NUMBERING_EXPORT_PAGE_SIZE,
          filters: { ...EMPTY_NUMBERING_FILTERS, inn: [FINENUMBERS_INN] },
        }),
      ));
  const summary =
    input.summary ??
    (() =>
      pstnTurn(() =>
        summarizeNumberingResource({
          ...EMPTY_NUMBERING_FILTERS,
          inn: [FINENUMBERS_INN],
        }),
      ));

  const attempt = async (): Promise<PageRead<NumberingRow> & { capacity?: number }> => {
    const pages = await readAllPages({
      page: list,
      accept,
      onProgress: input.onProgress,
    });
    if (!pages.ok) return pages;
    let recounted: NumberingSummary;
    try {
      recounted = await readRangePage(summary);
    } catch {
      return { ok: false, error: "Список диапазонов не прочитан. Каталог не изменён.", again: false };
    }
    if (!summaryAgrees(recounted, pages.items.map(keptRange))) {
      return { ok: false, error: TOTAL_CHANGED, again: true };
    }
    return pages;
  };

  const first = await attempt();
  const second = first.ok || !first.again ? first : await attempt();
  if (!second.ok) return { ok: false, error: second.error };
  const ranges = second.items.map(keptRange);
  let capacity = 0;
  for (const range of ranges) capacity = addCapacity(capacity, range.capacity);
  return { ok: true, ranges, capacity };
}
