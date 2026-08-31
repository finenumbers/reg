import { cdrMonthPrefix, utcCalendarMonth } from "@/lib/month-window";

export const CDR_MONTH_YEAR_MIN = 2000;
export const CDR_MONTH_YEAR_MAX = 2100;
export const CDR_DATE_BOUND_GTE = "2000-01";
export const CDR_DATE_BOUND_LT = "2101-01";

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

function monthFromCdrDate(raw: string | null | undefined): CdrMonth | null {
  if (!raw) return null;
  return parseMonthKey(raw.slice(0, 7));
}

function compareMonth(a: CdrMonth, b: CdrMonth): number {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

export function monthsFromCdrDateBounds(
  minDate: string | null | undefined,
  maxDate: string | null | undefined,
  current: CdrMonth,
): CdrMonth[] {
  const parsedMin = monthFromCdrDate(minDate);
  const parsedMax = monthFromCdrDate(maxDate);
  let start = current;
  let end = current;
  if (parsedMin && compareMonth(parsedMin, start) < 0) start = parsedMin;
  if (parsedMax && compareMonth(parsedMax, end) > 0) end = parsedMax;

  const out: CdrMonth[] = [];
  let year = end.year;
  let month = end.month;
  const guard = 12 * (CDR_MONTH_YEAR_MAX - CDR_MONTH_YEAR_MIN + 1);
  while (year > start.year || (year === start.year && month >= start.month)) {
    out.push({ year, month, key: monthKey(year, month) });
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    if (out.length >= guard) break;
  }
  return out;
}
