import { monthKey, type CdrMonth } from "@/modules/traffic/cdr-month";

export const MONTH_CALLS_UNAVAILABLE = "Счётчик звонков недоступен.";

/**
 * Inclusive month key and exclusive next month key.
 * For ASCII `YYYY-MM-DD` this is the same set as `left(day, 7) = key`.
 * December rolls the year the same way as `cdrMonthDayRange`, without the `-01` day bound.
 */
export function monthPrefixBounds(month: Pick<CdrMonth, "year" | "month" | "key">): {
  start: string;
  end: string;
} {
  const nextYear = month.month === 12 ? month.year + 1 : month.year;
  const nextMonth = month.month === 12 ? 1 : month.month + 1;
  return { start: month.key, end: monthKey(nextYear, nextMonth) };
}

/** A successful count. Anything else is a gap, including a truncated integer. */
export function parseDashboardCount(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || !Number.isSafeInteger(value) || value < 0)
      return null;
    return value;
  }
  if (typeof value === "bigint") {
    if (value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const parsed = BigInt(value);
    if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(parsed);
  }
  return null;
}
