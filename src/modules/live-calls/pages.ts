/** Pages requested after a full page. Five pages is 10_000 rows on one module. */
export const MAX_CALL_PAGES = 5;

export type PageDecision = {
  action: "stop" | "continue" | "duplicate" | "cap";
  append: boolean;
  truncated: boolean;
};

export function conferenceIdSet(
  rows: readonly Record<string, string>[],
  column: string,
): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const id = (row[column] ?? "").trim();
    if (id) ids.add(id);
  }
  return ids;
}

export function sameConferenceIds(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  if (left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
}

/**
 * A short page is the end of the table.
 * A full page asks for the next offset, up to the page cap.
 * The same Conference ID set means the offset was ignored: do not append it.
 * More rows than the page size stops too, so a larger answer is not skipped.
 */
export function decideNextPage(input: {
  pageIndex: number;
  rowCount: number;
  pageIds: ReadonlySet<string>;
  previousIds: ReadonlySet<string> | null;
  pageSize: number;
  maxPages: number;
}): PageDecision {
  const full = input.rowCount === input.pageSize;
  if (input.previousIds && full && sameConferenceIds(input.previousIds, input.pageIds)) {
    return { action: "duplicate", append: false, truncated: true };
  }
  if (input.rowCount > input.pageSize) {
    return { action: "stop", append: true, truncated: true };
  }
  if (!full) return { action: "stop", append: true, truncated: false };
  if (input.pageIndex >= input.maxPages - 1) {
    return { action: "cap", append: true, truncated: true };
  }
  return { action: "continue", append: true, truncated: false };
}
