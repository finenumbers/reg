import { formatCount } from "@/lib/format-count";

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
export const HOUR_MINUTES = 60;

/** ViewBox heights shared by the line and the vertical scale. */
export const AXIS_BASELINE = 98;
export const AXIS_TOP = 6;

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

export type UtcCallWindow = UtcCallDay & {
  /** First minute of the rolling hour. The open minute is the last of 60. */
  hourStart: Date;
  /**
   * Earlier of the day lookback and 24 hours before the hour window.
   * The extra stretch is at most 59 minutes, and only in the first hour
   * after midnight. Those calls end before today's midnight, so the day
   * series is unchanged.
   */
  scanStart: Date;
};

/**
 * Day and rolling hour from one instant, so the two windows cannot
 * disagree across a minute boundary.
 */
export function utcCallWindow(now: Date): UtcCallWindow {
  const day = utcCallDay(now);
  const hourStartMs = day.seriesEnd.getTime() - HOUR_MINUTES * MINUTE_MS;
  const hourLookbackMs = hourStartMs - DAY_MS;
  return {
    ...day,
    hourStart: new Date(hourStartMs),
    scanStart: new Date(Math.min(day.lookbackStart.getTime(), hourLookbackMs)),
  };
}

/** Civil UTC clock of a bucket. Index 0 is `origin`, not midnight. */
export function formatUtcMinute(origin: Date, index: number): string {
  const at = new Date(origin.getTime() + index * MINUTE_MS);
  const hour = String(at.getUTCHours()).padStart(2, "0");
  const minute = String(at.getUTCMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

/** 1, 2, 5, 10, 20, … at or above the peak. Zero stays zero. */
export function axisCeiling(peak: number): number {
  const value = clampLevel(peak);
  if (value <= 1) return value;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    const ceiling = step * magnitude;
    if (ceiling >= value) return ceiling;
  }
  return 10 * magnitude;
}

/** Top to bottom. A zero peak has only the baseline. */
export function axisTicks(peak: number): number[] {
  const ceiling = axisCeiling(peak);
  if (ceiling <= 0) return [0];
  const mid = ceiling / 2;
  if (Number.isInteger(mid) && mid > 0) return [ceiling, mid, 0];
  return [ceiling, 0];
}

/** CSS `top` percent. Matches the SVG y of the same value. */
export function axisTickTop(value: number, ceiling: number): number {
  if (ceiling <= 0) return AXIS_BASELINE;
  const clamped = Math.min(ceiling, Math.max(0, value));
  return AXIS_BASELINE - (clamped / ceiling) * (AXIS_BASELINE - AXIS_TOP);
}

export function sessionCountLabel(count: number): string {
  const n = Math.abs(Math.trunc(count));
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? "сессия"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? "сессии"
        : "сессий";
  return `${formatCount(n)} ${word}`;
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
