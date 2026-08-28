/**
 * Parse naive CSV datetime and convert to Excel serial without TZ shift.
 * Excel 1900 date system: serial 1 = 1899-12-31; we use the common
 * 1899-12-30 epoch so 2026-08-01 00:00:19 → 46235.0002199…
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

/** Excel serial (1900 date system) from civil components treated as naive UTC. */
export function civilToExcelSerial(civil: CivilDateTime): number {
  const utc = Date.UTC(
    civil.year,
    civil.month - 1,
    civil.day,
    civil.hour,
    civil.minute,
    civil.second,
  );
  const epoch = Date.UTC(1899, 11, 30, 0, 0, 0);
  return (utc - epoch) / 86_400_000;
}

export function csvTimeToExcelSerial(raw: string): number | null {
  const civil = parseCivilDateTime(raw);
  if (!civil) return null;
  return civilToExcelSerial(civil);
}
