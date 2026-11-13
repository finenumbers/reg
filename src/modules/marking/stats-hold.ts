import { PURGE_MONTH_BUSY_MESSAGE } from "@/modules/traffic/purge/target";

/** The open statistics table must drop its numbers on this answer. */
export function markingStatsFailureClearsRows(message: string): boolean {
  return message === PURGE_MONTH_BUSY_MESSAGE;
}
