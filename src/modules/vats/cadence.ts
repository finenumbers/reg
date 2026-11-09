/** Fixed VATS read cadence. Not a Settings field. */

export const VATS_FIRST_DELAY_MS = 5_000;
export const VATS_INTERVAL_MS = 120_000;
export const VATS_SECTION_BUDGET_MS = 45 * 60 * 1000;
export const VATS_DOMAIN_LIMIT = 1_000;
export const VATS_TELNUM_LIMIT = 5_000;
export const VATS_SOFT_LIMIT = 5;
export const VATS_PAGE_SIZE = 100;
export const VATS_STATUS_POLL_MS = 15_000;

export function nextVatsDelayMs(restart: boolean): number {
  return restart ? 0 : VATS_INTERVAL_MS;
}
