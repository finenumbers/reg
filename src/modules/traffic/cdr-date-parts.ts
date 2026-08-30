/**
 * Mechanical split of stored `cdr_date` into day/time — same bytes as SQL
 * `left(cdr_date, 10)` / `substring(cdr_date from 12 for 8)`.
 * Not civil calendar parsing; fractional seconds are dropped by slice.
 */

/** Unanchored prefix; keep in sync with the migration UPDATE and sync-cdr-at. */
export const CDR_DATE_CIVIL_REGEX =
  "^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}";

const CIVIL_PREFIX = new RegExp(CDR_DATE_CIVIL_REGEX);
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export type CdrDateParts = {
  day: string;
  time: string;
};

/**
 * JS `slice(11, 19)` equals SQL `substring(cdr_date from 12 for 8)` (1-based).
 * Space and `T` both sit at index 10.
 */
export function splitCdrDateParts(raw: string): CdrDateParts {
  const trimmed = raw.trim();
  if (!CIVIL_PREFIX.test(trimmed)) return { day: "", time: "" };
  return {
    day: trimmed.slice(0, 10),
    time: trimmed.slice(11, 19),
  };
}

/** Stored `YYYY-MM-DD` → `DD.MM.YYYY`. Unparseable stays as-is. */
export function formatCdrDayDisplay(raw: string): string {
  const match = ISO_DAY.exec(raw.trim());
  if (!match) return raw;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

/** XLSX date/time cells from the enrich JSONL `time` field. */
export function xlsxCdrDateTimeCells(raw: string): CdrDateParts {
  const parts = splitCdrDateParts(raw);
  return {
    day: parts.day ? formatCdrDayDisplay(parts.day) : "",
    time: parts.time,
  };
}
