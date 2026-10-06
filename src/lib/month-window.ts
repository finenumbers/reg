/**
 * UTC calendar month of a CDR `cdr_date` prefix (`YYYY-MM-`).
 */

export function utcCalendarMonth(now: Date = new Date()): {
  year: number;
  month: number;
} {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

export function cdrMonthPrefix(year: number, month: number): string {
  if (month < 1 || month > 12) {
    throw new Error(`Некорректный месяц: ${month}`);
  }
  return `${year}-${String(month).padStart(2, "0")}-`;
}
