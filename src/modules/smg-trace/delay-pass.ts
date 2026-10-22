/**
 * Separate from the antifraud label revision. Raising that one rewrites every
 * CDR category. A later delay rule raises only this number. The batch fills
 * rows whose arrays are still NULL, so a new revision recomputes stored cards
 * only after those arrays are cleared.
 */
export const AF_DELAY_REVISION = 1;

export const DELAY_DEVICE = "@delays";
export const DELAY_FILE_KEY = "@revision";
export const DELAY_BATCH = 200;

export type DelayMark = {
  revision: number;
  done: boolean;
};

export function openDelayMark(raw: unknown): DelayMark {
  if (!raw || typeof raw !== "object") return freshMark();
  const row = raw as { revision?: unknown; done?: unknown };
  if (row.revision !== AF_DELAY_REVISION) return freshMark();
  return { revision: AF_DELAY_REVISION, done: row.done === true };
}

export function advanceDelayMark(
  mark: DelayMark,
  scanned: number,
  batchSize: number,
): DelayMark {
  return { revision: mark.revision, done: scanned < batchSize };
}

function freshMark(): DelayMark {
  return { revision: AF_DELAY_REVISION, done: false };
}
