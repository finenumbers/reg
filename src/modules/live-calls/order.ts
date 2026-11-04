/** ISO civil time, or day-first `DD.MM.YYYY` with an optional comma. */
const ISO_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const DMY_TIME = /^(\d{2})\.(\d{2})\.(\d{4}),? (\d{2}):(\d{2}):(\d{2})$/;

/**
 * Canonical `YYYY-MM-DD HH:MM:SS` for a UTC cell.
 * The digits are rearranged, not shifted into another zone.
 * A month, day, or clock outside the civil ranges is not a time.
 * Day 31 is kept in every month, so February 31 stays February 31.
 */
export function startSortKey(raw: string): string | null {
  const trimmed = raw.trim();
  const iso = ISO_TIME.exec(trimmed);
  if (iso) {
    if (!civilRanges(iso[2], iso[3], iso[4], iso[5], iso[6])) return null;
    return `${iso[1]}-${iso[2]}-${iso[3]} ${iso[4]}:${iso[5]}:${iso[6]}`;
  }
  const dmy = DMY_TIME.exec(trimmed);
  if (!dmy) return null;
  if (!civilRanges(dmy[2], dmy[1], dmy[4], dmy[5], dmy[6])) return null;
  return `${dmy[3]}-${dmy[2]}-${dmy[1]} ${dmy[4]}:${dmy[5]}:${dmy[6]}`;
}

function civilRanges(
  month: string | undefined,
  day: string | undefined,
  hour: string | undefined,
  minute: string | undefined,
  second: string | undefined,
): boolean {
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  const secondNumber = Number(second);
  return (
    monthNumber >= 1 &&
    monthNumber <= 12 &&
    dayNumber >= 1 &&
    dayNumber <= 31 &&
    hourNumber <= 23 &&
    minuteNumber <= 59 &&
    secondNumber <= 59
  );
}

/**
 * Newer parsed start time first.
 * A blank or any other text sorts after every parsed stamp.
 * Two parsed equals, or two unparsed values, compare as zero.
 */
export function compareLiveCallStart(left: string, right: string): number {
  const parsedLeft = startSortKey(left);
  const parsedRight = startSortKey(right);
  if (parsedLeft && parsedRight) {
    if (parsedLeft === parsedRight) return 0;
    return parsedLeft < parsedRight ? 1 : -1;
  }
  if (parsedLeft) return -1;
  if (parsedRight) return 1;
  return 0;
}

/**
 * Descending «Время начала». Equal stamps and unparsed rows keep join order.
 */
export function orderLiveCallsByStart<T extends { startedAt: string }>(
  rows: readonly T[],
): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const byTime = compareLiveCallStart(left.row.startedAt, right.row.startedAt);
      if (byTime !== 0) return byTime;
      return left.index - right.index;
    })
    .map((item) => item.row);
}
