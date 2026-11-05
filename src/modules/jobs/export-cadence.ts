/** Phone catalog period is the Settings export interval. Groups run twice as rarely. */

export const MIN_SCHEDULE_INTERVAL_SEC = 30;
export const EXPORT_DEFER_SEC = 20;
export const FIRST_PHONES_DELAY_SEC = 45;
export const FIRST_GROUPS_DELAY_SEC = 90;
export const GROUPS_INTERVAL_MULTIPLIER = 2;

export function clampScheduleInterval(raw: number | undefined, fallback: number): number {
  const value = raw ?? fallback;
  if (!Number.isFinite(value)) return Math.max(MIN_SCHEDULE_INTERVAL_SEC, fallback);
  return Math.max(MIN_SCHEDULE_INTERVAL_SEC, value);
}

export function groupsIntervalSec(exportIntervalSec: number): number {
  return clampScheduleInterval(exportIntervalSec, 300) * GROUPS_INTERVAL_MULTIPLIER;
}

export function describeExportPeriods(exportIntervalSec: number): {
  phonesSec: number;
  groupsSec: number;
} {
  const phonesSec = clampScheduleInterval(exportIntervalSec, 300);
  return { phonesSec, groupsSec: phonesSec * GROUPS_INTERVAL_MULTIPLIER };
}
