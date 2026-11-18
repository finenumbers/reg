/** Daily numbering chain. The hour is UTC, not the process timezone. */

const CHAIN_HOUR_UTC = 17;
const DAY_MS = 86_400_000;

/**
 * Delay until the next strict future HH:00 UTC.
 * A clock sitting on that exact second waits a full day, so process start does not catch a window.
 */
export function msUntilNextUtcHour(now: Date, hour = CHAIN_HOUR_UTC): number {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hour,
    0,
    0,
    0,
  );
  if (now.getTime() < today) return today - now.getTime();
  return today + DAY_MS - now.getTime();
}
