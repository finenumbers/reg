/**
 * Parse naive CSV datetime and format for XLSX without TZ shift.
 */

const CIVIL =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

export type CivilDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function parseCivilDateTime(raw: string): CivilDateTime | null {
  const match = CIVIL.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  return { year, month, day, hour, minute, second };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatCivilDisplay(civil: CivilDateTime): string {
  return `${pad2(civil.day)}.${pad2(civil.month)}.${civil.year}, ${pad2(civil.hour)}:${pad2(civil.minute)}:${pad2(civil.second)}`;
}

export function csvTimeToDisplay(raw: string): string {
  const civil = parseCivilDateTime(raw);
  if (!civil) return raw;
  return formatCivilDisplay(civil);
}

/** Pack civil Y-M-D H:M:S as a UTC instant (digits unchanged). */
export function civilToUtcDate(civil: CivilDateTime): Date {
  return new Date(
    Date.UTC(
      civil.year,
      civil.month - 1,
      civil.day,
      civil.hour,
      civil.minute,
      civil.second,
    ),
  );
}

const HAS_OFFSET = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

/**
 * Naive `YYYY-MM-DD HH:MM:SS` → civil-as-UTC.
 * Strings with Z / numeric offset stay real instants.
 */
export function parseNaiveDateTime(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (HAS_OFFSET.test(trimmed)) {
    const instant = Date.parse(trimmed);
    return Number.isFinite(instant) ? new Date(instant) : null;
  }
  const civil = parseCivilDateTime(trimmed);
  if (!civil) return null;
  return civilToUtcDate(civil);
}
