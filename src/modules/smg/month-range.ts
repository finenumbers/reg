import { monthKey, type CdrMonth } from "@/modules/traffic/cdr-month";

/**
 * Inclusive start and exclusive end of a civil month on SMG disconnect time.
 * Values match the stored `YYYY-MM-DD HH:MM:SS` text, so the comparison is
 * lexicographic. A parameterized range can use a btree; a `LIKE` parameter cannot.
 */
function nextMonthKey(month: CdrMonth): string {
  const nextYear = month.month === 12 ? month.year + 1 : month.year;
  const nextMonth = month.month === 12 ? 1 : month.month + 1;
  return monthKey(nextYear, nextMonth);
}

export function smgMonthTimeRange(month: CdrMonth): { gte: string; lt: string } {
  return {
    gte: `${month.key}-01 00:00:00`,
    lt: `${nextMonthKey(month)}-01 00:00:00`,
  };
}

/** Inclusive start and exclusive end of `disconnect_day` (`YYYY-MM-DD`). */
export function smgMonthDayRange(month: CdrMonth): { gte: string; lt: string } {
  return { gte: `${month.key}-01`, lt: `${nextMonthKey(month)}-01` };
}
