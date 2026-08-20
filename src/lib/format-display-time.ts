/**
 * Operator-facing date/time: `20.08.2026, 18:50:05` in a chosen IANA zone.
 */

import { DEFAULT_DISPLAY_TIMEZONE } from "@/lib/display-timezone";

function partsFor(
  date: Date,
  timeZone: string,
): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
}

function part(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

export function formatDisplayTimestamp(
  value: string | Date | null | undefined,
  timeZone: string,
): string {
  if (value == null || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = partsFor(date, timeZone);
  return `${part(parts, "day")}.${part(parts, "month")}.${part(parts, "year")}, ${part(parts, "hour")}:${part(parts, "minute")}:${part(parts, "second")}`;
}

/** Compact stamp for download filenames: `20260820-1850` in display TZ. */
export function formatExportTimestamp(
  d: Date = new Date(),
  timeZone: string = DEFAULT_DISPLAY_TIMEZONE,
): string {
  const parts = partsFor(d, timeZone);
  return `${part(parts, "year")}${part(parts, "month")}${part(parts, "day")}-${part(parts, "hour")}${part(parts, "minute")}`;
}
