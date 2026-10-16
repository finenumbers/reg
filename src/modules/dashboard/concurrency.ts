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
/** Rolling window under the day chart. The open minute is the last bucket. */
export const TWO_HOUR_MINUTES = 120;
/**
 * Tail that can still move: a softswitch call lasts at most 3600 seconds,
 * so its CDR may arrive after the minute it occupied.
 */
export const PROVISIONAL_MINUTES = 60;

const WEEKDAYS_RU = [
  "воскресенье",
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
] as const;

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
  /** First minute of the rolling two hours. The open minute is the last of 120. */
  recentStart: Date;
  /**
   * Earlier of the day lookback and 24 hours before the two-hour window.
   * The extra stretch is at most 119 minutes, and only in the first two hours
   * after midnight. Those calls end before today's midnight, so the day
   * series is unchanged.
   */
  scanStart: Date;
};

/**
 * Day and rolling two hours from one instant, so the two windows cannot
 * disagree across a minute boundary.
 */
export function utcCallWindow(now: Date): UtcCallWindow {
  const day = utcCallDay(now);
  const recentStartMs = day.seriesEnd.getTime() - TWO_HOUR_MINUTES * MINUTE_MS;
  const recentLookbackMs = recentStartMs - DAY_MS;
  return {
    ...day,
    recentStart: new Date(recentStartMs),
    scanStart: new Date(Math.min(day.lookbackStart.getTime(), recentLookbackMs)),
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
  return countedLabel(count, "сессия", "сессии", "сессий");
}

/** One error CDR in a minute. Not an overlapping session. */
export function eventCountLabel(count: number): string {
  return countedLabel(count, "событие", "события", "событий");
}

function countedLabel(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(Math.trunc(count));
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? one
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? few
        : many;
  return `${formatCount(n)} ${word}`;
}

/** `16.10.2026 (пятница)` for the chart's UTC civil day. Invalid dates are rejected. */
export function formatTrafficDayTitle(day: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, date));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== date
  ) {
    return null;
  }
  const dd = String(date).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return `${dd}.${mm}.${year} (${WEEKDAYS_RU[utc.getUTCDay()]})`;
}

/** First index of the blue tail. A short series is blue from the start. */
export function provisionalMinuteIndex(length: number): number {
  if (!Number.isFinite(length)) return 0;
  const count = Math.max(0, Math.trunc(length));
  return Math.max(0, count - PROVISIONAL_MINUTES);
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

export type MinuteCountRow = {
  /** Whole minutes since the series origin. */
  minute: number;
  count: number;
};

/**
 * One count per minute. A minute with no rows is zero: an error does not
 * carry into the next minute the way an open call does.
 */
export function fillEventCounts(
  minuteCount: number,
  rows: readonly MinuteCountRow[],
): number[] {
  const count = Math.max(0, Math.min(1440, Math.trunc(minuteCount)));
  const series = new Array<number>(count).fill(0);
  for (const row of rows) {
    if (row.minute >= 0 && row.minute < count) series[row.minute] = clampLevel(row.count);
  }
  return series;
}

function clampLevel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}
