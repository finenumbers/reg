/** Fixed RTU poll periods. Settings does not choose these. */

export const MIN_SCHEDULE_INTERVAL_SEC = 30;
export const EXPORT_DEFER_SEC = 20;
export const FIRST_PHONES_DELAY_SEC = 45;
export const FIRST_GROUPS_DELAY_SEC = 90;

export const REGS_POLL_INTERVAL_SEC = 30;
export const PHONES_SYNC_INTERVAL_SEC = 60;
export const GROUPS_SYNC_INTERVAL_SEC = 120;

/**
 * Delays after a settings save. Arming the full periods from one instant
 * would put phones on every second regs tick and groups on both.
 */
export const REGS_RESCHEDULE_DELAY_SEC = 30;
export const PHONES_RESCHEDULE_DELAY_SEC = 45;
export const GROUPS_RESCHEDULE_DELAY_SEC = 75;

export function clampScheduleInterval(raw: number | undefined, fallback: number): number {
  const value = raw ?? fallback;
  if (!Number.isFinite(value)) return Math.max(MIN_SCHEDULE_INTERVAL_SEC, fallback);
  return Math.max(MIN_SCHEDULE_INTERVAL_SEC, value);
}

export function catalogPeriodSec(kind: "phones.sync" | "groups.sync"): number {
  return kind === "groups.sync" ? GROUPS_SYNC_INTERVAL_SEC : PHONES_SYNC_INTERVAL_SEC;
}
