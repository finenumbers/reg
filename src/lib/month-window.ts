/**
 * Calendar month bounds in a curated display timezone (no DST).
 */

import {
  resolveDisplayTimezone,
  TZ_OFFSET_HOURS,
} from "@/lib/display-timezone";

export type MonthPeriod = "previous" | "current";

export type CivilClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type MonthWindow = {
  period: MonthPeriod;
  year: number;
  month: number;
  start: Date;
  /** Exclusive for previous; inclusive `now` for current. */
  end: Date;
  endInclusive: boolean;
};

export function zonedCivilToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const zone = resolveDisplayTimezone(timeZone);
  const offsetHours = TZ_OFFSET_HOURS[zone];
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute, second) -
      offsetHours * 3600_000,
  );
}

export function civilNow(
  timeZone: string,
  now: Date = new Date(),
): CivilClock {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: resolveDisplayTimezone(timeZone),
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const num = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: num("year"),
    month: num("month"),
    day: num("day"),
    hour: num("hour"),
    minute: num("minute"),
    second: num("second"),
  };
}

export function utcCalendarMonth(now: Date = new Date()): {
  year: number;
  month: number;
} {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

export function previousUtcMonth(
  year: number,
  month: number,
): { year: number; month: number } {
  if (month < 1 || month > 12) {
    throw new Error(`Некорректный месяц: ${month}`);
  }
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

export function utcExportMonth(
  period: MonthPeriod,
  now: Date = new Date(),
): { year: number; month: number } {
  const current = utcCalendarMonth(now);
  return period === "current"
    ? current
    : previousUtcMonth(current.year, current.month);
}

export function cdrMonthPrefix(year: number, month: number): string {
  if (month < 1 || month > 12) {
    throw new Error(`Некорректный месяц: ${month}`);
  }
  return `${year}-${String(month).padStart(2, "0")}-`;
}

export function monthWindow(
  period: MonthPeriod,
  timeZone: string,
  now: Date = new Date(),
): MonthWindow {
  const zone = resolveDisplayTimezone(timeZone);
  const civil = civilNow(zone, now);
  if (period === "current") {
    const start = zonedCivilToUtc(civil.year, civil.month, 1, 0, 0, 0, zone);
    return {
      period,
      year: civil.year,
      month: civil.month,
      start,
      end: now,
      endInclusive: true,
    };
  }
  let year = civil.year;
  let month = civil.month - 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  const start = zonedCivilToUtc(year, month, 1, 0, 0, 0, zone);
  const end = zonedCivilToUtc(civil.year, civil.month, 1, 0, 0, 0, zone);
  return {
    period,
    year,
    month,
    start,
    end,
    endInclusive: false,
  };
}
