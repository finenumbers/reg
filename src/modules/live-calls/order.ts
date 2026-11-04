/** Civil start time as the cell shows it. Digit order matches the switch clock. */
const START_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Earlier parsed start time first.
 * A blank or any other text sorts after every parsed stamp.
 * Two parsed equals, or two unparsed values, compare as zero.
 */
export function compareLiveCallStart(left: string, right: string): number {
  const parsedLeft = START_TIME.test(left);
  const parsedRight = START_TIME.test(right);
  if (parsedLeft && parsedRight) {
    if (left === right) return 0;
    return left < right ? -1 : 1;
  }
  if (parsedLeft) return -1;
  if (parsedRight) return 1;
  return 0;
}

/**
 * Ascending «Время начала». Equal stamps and unparsed rows keep join order.
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
