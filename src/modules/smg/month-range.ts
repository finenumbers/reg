import { monthKey, type CdrMonth } from "@/modules/traffic/cdr-month";

/**
 * Inclusive start and exclusive end of a civil month on SMG disconnect time.
 * Values match the stored `YYYY-MM-DD HH:MM:SS` text, so the comparison is
 * lexicographic. A parameterized range can use a btree; a `LIKE` parameter cannot.
 */
export function smgMonthTimeRange(month: CdrMonth): { gte: string; lt: string } {
  const gte = `${month.key}-01 00:00:00`;
  const nextYear = month.month === 12 ? month.year + 1 : month.year;
  const nextMonth = month.month === 12 ? 1 : month.month + 1;
  return { gte, lt: `${monthKey(nextYear, nextMonth)}-01 00:00:00` };
}
