/** One minute of the concurrency sweep. Quiet minutes are absent. */
export type MinuteEventRow = {
  /** Whole minutes since UTC midnight of the chart day. */
  minute: number;
  /** Highest level after an event inside the minute. */
  peak: number;
  /** Level after the last event in the minute. This becomes the next carry. */
  levelAtEnd: number;
  /**
   * An event lands on the minute's opening instant.
   * The carry from the previous minute is then already in `peak` or already over:
   * a call that ends exactly on the boundary does not occupy this minute.
   */
  touchesStart: boolean;
};

export type UtcCallDay = {
  dayStart: Date;
  dayEnd: Date;
  lookbackStart: Date;
  seriesEnd: Date;
  minuteCount: number;
  day: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * Current UTC day in the same civil clock as `cdrAt`.
 * The series includes the minute that is still open and stops after it.
 */
export function utcCallDay(now: Date): UtcCallDay {
  const dayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const elapsed = Math.floor((now.getTime() - dayStartMs) / MINUTE_MS);
  const minuteCount = Math.min(1440, Math.max(1, elapsed + 1));
  const dayStart = new Date(dayStartMs);
  return {
    dayStart,
    dayEnd: new Date(dayStartMs + DAY_MS),
    lookbackStart: new Date(dayStartMs - DAY_MS),
    seriesEnd: new Date(dayStartMs + minuteCount * MINUTE_MS),
    minuteCount,
    day: utcDayStamp(dayStart),
  };
}

export function utcDayStamp(dayStart: Date): string {
  const year = dayStart.getUTCFullYear();
  const month = String(dayStart.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dayStart.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Turn event minutes plus the occupancy carried into the day into one value per
 * minute. A minute with no events keeps the level it started with, so a long
 * call does not become a hole. Minutes at or after `minuteCount` are omitted.
 */
export function fillConcurrencyMinutes(
  minuteCount: number,
  carryIn: number,
  rows: readonly MinuteEventRow[],
): number[] {
  const count = Math.max(0, Math.min(1440, Math.trunc(minuteCount)));
  const byMinute = new Map<number, MinuteEventRow>();
  for (const row of rows) {
    if (row.minute >= 0 && row.minute < count) byMinute.set(row.minute, row);
  }

  const series = new Array<number>(count);
  let carry = clampLevel(carryIn);
  for (let minute = 0; minute < count; minute += 1) {
    const row = byMinute.get(minute);
    if (!row) {
      series[minute] = carry;
      continue;
    }
    const afterEvents = clampLevel(row.peak);
    series[minute] = row.touchesStart ? afterEvents : Math.max(carry, afterEvents);
    carry = clampLevel(row.levelAtEnd);
  }
  return series;
}

function clampLevel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}
