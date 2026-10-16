import { cdrMonthPrefix, utcCalendarMonth } from "@/lib/month-window";

export const CDR_MONTH_YEAR_MIN = 2000;
export const CDR_MONTH_YEAR_MAX = 2100;

const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/;

export type CdrMonth = {
  year: number;
  month: number;
  key: string;
  count?: number;
};

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Inclusive `cdr_day` start and exclusive next-month start. December rolls the year. */
export function cdrMonthDayRange(
  year: number,
  month: number,
): { start: string; end: string } {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Некорректный месяц: ${year}-${month}`);
  }
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  return { start, end };
}

export function parseMonthKey(
  raw: string | null | undefined,
): CdrMonth | null {
  const match = MONTH_KEY_RE.exec(raw?.trim() ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  if (year < CDR_MONTH_YEAR_MIN || year > CDR_MONTH_YEAR_MAX) return null;
  return { year, month, key: monthKey(year, month) };
}

export function currentUtcMonth(now: Date = new Date()): CdrMonth {
  const { year, month } = utcCalendarMonth(now);
  return { year, month, key: monthKey(year, month) };
}

export function resolveMonthKey(
  raw: string | null | undefined,
  now?: Date,
): CdrMonth {
  return parseMonthKey(raw) ?? currentUtcMonth(now);
}

export function applyMonthFilter(
  year: number,
  month: number,
): { cdrDate: { startsWith: string } } {
  return { cdrDate: { startsWith: cdrMonthPrefix(year, month) } };
}

/** Month key from the Дата column (`YYYY-MM-DD` → `YYYY-MM`). */
export function monthKeyFromCdrDay(
  raw: string | null | undefined,
): CdrMonth | null {
  if (!raw) return null;
  return parseMonthKey(raw.trim().slice(0, 7));
}

export function compareMonthKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Oldest complete month (not the current UTC calendar month, count > 0). */
export function deletableMonthKey(
  months: readonly Pick<CdrMonth, "key" | "count">[],
  currentKey: string,
): string | null {
  let oldest: string | null = null;
  for (const item of months) {
    if (item.key === currentKey) continue;
    if ((item.count ?? 0) <= 0) continue;
    if (oldest == null || compareMonthKey(item.key, oldest) < 0) {
      oldest = item.key;
    }
  }
  return oldest;
}

export function withCurrentMonth(
  months: CdrMonth[],
  current: CdrMonth,
): CdrMonth[] {
  if (months.some((item) => item.key === current.key)) return months;
  return [{ ...current, count: current.count ?? 0 }, ...months];
}

/** Sum of per-month call counts (empty current-month slot is 0). */
export function sumMonthRecordCounts(
  months: readonly Pick<CdrMonth, "count">[],
): number {
  let total = 0;
  for (const item of months) {
    total += item.count ?? 0;
  }
  return total;
}
