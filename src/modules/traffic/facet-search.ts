/**
 * Map header-menu search text to raw CDR tokens.
 * Display formats (civil date, duration seconds) must still find stored values.
 */

const DURATION_COLUMNS = new Set(["elapsed_time", "term_elapsed_time"]);
const COUNT_SEP = /[\u202F\s]/g;
const MAX_DISPLAYED_SECONDS = 86_400;

const DATE_TIME =
  /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[,\s]+(\d{1,2})(?::(\d{2})(?::(\d{2}))?)?)?$/;
const MONTH_YEAR = /^(\d{1,2})\.(\d{4})$/;
const DAY_MONTH = /^(\d{1,2})\.(\d{1,2})$/;

export type FacetSearchMatch =
  | { kind: "contains"; needles: string[] }
  | { kind: "in"; values: string[] };

export function isDurationFacetColumn(column: string): boolean {
  return DURATION_COLUMNS.has(column);
}

export function displayDateQueryToRaw(q: string): string | null {
  const trimmed = q.trim();
  if (!trimmed) return null;

  const full = DATE_TIME.exec(trimmed);
  if (full) {
    const day = Number(full[1]);
    const month = Number(full[2]);
    if (!validDayMonth(day, month)) return null;
    let raw = `${full[3]}-${pad2(month)}-${pad2(day)}`;
    if (full[4] != null) {
      const hour = Number(full[4]);
      if (hour > 23) return null;
      raw += ` ${pad2(hour)}`;
      if (full[5] != null) {
        raw += `:${full[5]}`;
        if (full[6] != null) raw += `:${full[6]}`;
      }
    }
    return raw;
  }

  const monthYear = MONTH_YEAR.exec(trimmed);
  if (monthYear) {
    const month = Number(monthYear[1]);
    if (month < 1 || month > 12) return null;
    return `${monthYear[2]}-${pad2(month)}`;
  }

  const dayMonth = DAY_MONTH.exec(trimmed);
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const month = Number(dayMonth[2]);
    if (!validDayMonth(day, month)) return null;
    return `-${pad2(month)}-${pad2(day)}`;
  }

  return null;
}

export function cdrDateSearchNeedles(q: string): string[] {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const needles = [trimmed];
  const mapped = displayDateQueryToRaw(trimmed);
  if (mapped && mapped !== trimmed) needles.push(mapped);
  return [...new Set(needles)];
}

function dateOnlyFromMapped(mapped: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(mapped) ? mapped.slice(0, 10) : mapped;
}

function timeOnlyFromMapped(mapped: string): string | null {
  const space = mapped.indexOf(" ");
  if (space < 0) return null;
  const time = mapped.slice(space + 1);
  return time || null;
}

/** Header search for `cdr_day` — date token only, never `YYYY-MM-DD HH:MM:SS`. */
export function cdrDaySearchNeedles(q: string): string[] {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const needles = [trimmed];
  const mapped = displayDateQueryToRaw(trimmed);
  if (mapped) {
    const day = dateOnlyFromMapped(mapped);
    if (day !== trimmed) needles.push(day);
  }
  return [...new Set(needles)];
}

/** Header search for `cdr_time` — time token only. */
export function cdrTimeSearchNeedles(q: string): string[] {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const needles = [trimmed];
  const mapped = displayDateQueryToRaw(trimmed);
  if (mapped) {
    const time = timeOnlyFromMapped(mapped);
    if (time && time !== trimmed) needles.push(time);
  }
  return [...new Set(needles)];
}

export function parseDisplayedSeconds(q: string): number | null {
  const cleaned = q.trim().replace(COUNT_SEP, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function millisecondTokensForDisplayedSeconds(seconds: number): string[] {
  if (seconds === 0) return ["0"];
  const start = (seconds - 1) * 1000 + 1;
  const end = seconds * 1000;
  const out: string[] = [];
  for (let ms = start; ms <= end; ms++) out.push(String(ms));
  return out;
}

export function facetSearchMatch(column: string, q: string): FacetSearchMatch {
  const trimmed = q.trim();
  if (!trimmed) return { kind: "contains", needles: [] };

  if (isDurationFacetColumn(column)) {
    const seconds = parseDisplayedSeconds(trimmed);
    if (seconds != null) {
      const exact = trimmed.replace(COUNT_SEP, "");
      const values = new Set<string>([exact]);
      if (seconds <= MAX_DISPLAYED_SECONDS) {
        for (const token of millisecondTokensForDisplayedSeconds(seconds)) {
          values.add(token);
        }
      }
      return { kind: "in", values: [...values] };
    }
  }

  if (column === "cdr_date") {
    return { kind: "contains", needles: cdrDateSearchNeedles(trimmed) };
  }
  if (column === "cdr_day") {
    return { kind: "contains", needles: cdrDaySearchNeedles(trimmed) };
  }
  if (column === "cdr_time") {
    return { kind: "contains", needles: cdrTimeSearchNeedles(trimmed) };
  }

  return { kind: "contains", needles: [trimmed] };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function validDayMonth(day: number, month: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}
