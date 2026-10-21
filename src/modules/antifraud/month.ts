export type ZonedMonth = {
  year: number;
  month: number;
  key: string;
};

function zonedParts(
  date: Date,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function parseMonthKey(key: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match?.[1] || !match[2]) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function zonedMonth(now: Date, timeZone: string): ZonedMonth {
  const parts = zonedParts(now, timeZone);
  return { year: parts.year, month: parts.month, key: monthKey(parts.year, parts.month) };
}

function startOfZonedDay(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  let guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  for (let i = 0; i < 4; i += 1) {
    const parts = zonedParts(guess, timeZone);
    const desired = Date.UTC(year, month - 1, day, 0, 0, 0);
    const actual = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const delta = desired - actual;
    if (delta === 0) return guess;
    guess = new Date(guess.getTime() + delta);
  }
  return guess;
}

/** Half-open UTC range of a calendar month in the operator timezone. */
export function zonedMonthRange(
  year: number,
  month: number,
  timeZone: string,
): { start: Date; end: Date } {
  const start = startOfZonedDay(year, month, 1, timeZone);
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const end = startOfZonedDay(next.year, next.month, 1, timeZone);
  return { start, end };
}
