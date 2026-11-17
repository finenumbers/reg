/**
 * One complete PSTN range list. Completeness is the locked total, not hasMore.
 * A transport failure retries the same page once. A shifted total restarts once.
 */

import { NumberingClientError } from "@/modules/numbering-resource/errors";

export const RANGE_PAGE_LIMIT = 500;

export const TOTAL_CHANGED = "Количество номеров изменилось. Каталог не изменён.";
export const INCOMPLETE = "Список диапазонов неполный. Каталог не изменён.";
export const PAGE_LONG = "Страница длиннее запрошенного лимита.";
export const READ_FAILED = "Список диапазонов не прочитан. Каталог не изменён.";

export type RangePage<T extends { id: number }> = {
  items: T[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
};

export type PageVerdict = { kind: "keep" } | { kind: "skip" } | { kind: "fail"; error: string };

export type PageRead<T> =
  | { ok: true; items: T[]; total: number }
  | { ok: false; error: string; again: boolean };

export function rangeReadRetriable(error: unknown): boolean {
  if (!(error instanceof NumberingClientError)) return false;
  if (error.code === "TIMEOUT" || error.code === "NETWORK" || error.code === "BAD_RESPONSE") {
    return true;
  }
  return error.code === "HTTP_ERROR" && (error.httpStatus ?? 0) >= 500;
}

export async function readRangePage<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (!rangeReadRetriable(error)) throw error;
    return load();
  }
}

function readError(error: unknown): string {
  if (error instanceof NumberingClientError && error.code === "HTTP_ERROR") {
    return READ_FAILED;
  }
  return READ_FAILED;
}

export async function readAllPages<T extends { id: number }>(input: {
  page: (cursor: string | null) => Promise<RangePage<T>>;
  accept: (row: T) => PageVerdict;
  onProgress?: (seen: number, total: number) => Promise<void>;
  limit?: number;
}): Promise<PageRead<T>> {
  const limit = input.limit ?? RANGE_PAGE_LIMIT;
  const seenIds = new Set<number>();
  const kept: T[] = [];
  let cursor: string | null = null;
  let locked: number | null = null;
  let seen = 0;
  for (;;) {
    let page: RangePage<T>;
    try {
      page = await readRangePage(() => input.page(cursor));
    } catch (error) {
      return { ok: false, error: readError(error), again: false };
    }
    if (page.items.length > limit) return { ok: false, error: PAGE_LONG, again: false };
    if (!Number.isSafeInteger(page.total) || page.total < 0) {
      return { ok: false, error: INCOMPLETE, again: false };
    }
    if (locked == null) locked = page.total;
    else if (page.total !== locked) return { ok: false, error: TOTAL_CHANGED, again: true };
    for (const row of page.items) {
      if (seenIds.has(row.id)) return { ok: false, error: INCOMPLETE, again: true };
      seenIds.add(row.id);
      const verdict = input.accept(row);
      if (verdict.kind === "fail") return { ok: false, error: verdict.error, again: false };
      if (verdict.kind === "keep") kept.push(row);
      seen += 1;
    }
    if (input.onProgress) await input.onProgress(seen, locked);
    if (!page.hasMore || page.items.length === 0) {
      if (seen !== locked) return { ok: false, error: INCOMPLETE, again: true };
      return { ok: true, items: kept, total: locked };
    }
    if (!page.nextCursor) return { ok: false, error: INCOMPLETE, again: true };
    cursor = page.nextCursor;
  }
}

export async function readAllPagesTwice<T extends { id: number }>(
  input: Parameters<typeof readAllPages<T>>[0],
): Promise<PageRead<T>> {
  const first = await readAllPages(input);
  if (first.ok || !first.again) return first;
  return readAllPages(input);
}
