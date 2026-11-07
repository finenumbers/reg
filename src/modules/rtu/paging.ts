import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";

export const RTU_MAX_PAGE_SIZE = 200;

export function clampPage(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

export function clampPageSize(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return TABLE_PAGE_SIZE;
  return Math.min(RTU_MAX_PAGE_SIZE, Math.max(1, Math.floor(value)));
}

/**
 * A further page may be appended only while the catalog snapshot is the same.
 * `phones.sync` replaces every endpoint id.
 */
export function geographyAppendAllowed(loadedStamp: string, nextStamp: string): boolean {
  return loadedStamp === nextStamp;
}

/** Client timer floor. Matches the settings schema. */
export function refreshIntervalMs(intervalSec: number): number {
  const sec = Number.isFinite(intervalSec) ? intervalSec : 60;
  return Math.min(86400, Math.max(30, Math.floor(sec))) * 1000;
}
