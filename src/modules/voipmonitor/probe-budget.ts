import {
  ARCHIVE_RETRY_PROBE_BUDGET,
  LIVE_PROBE_BUDGET,
} from "@/modules/voipmonitor/constants";
import type { MatchLane } from "@/modules/voipmonitor/lanes";

export function probeBudgetForLane(
  lane: MatchLane,
  maxAttemptCount: number,
): number {
  if (lane === "live") return LIVE_PROBE_BUDGET;
  return maxAttemptCount >= 1 ? ARCHIVE_RETRY_PROBE_BUDGET : 0;
}

export function effectiveProbeBudget(
  requested: number,
  hourFetchCount: number,
  fetchLooksIncomplete: boolean,
): number {
  if (hourFetchCount <= 0) return 0;
  if (fetchLooksIncomplete) {
    return Math.max(requested, ARCHIVE_RETRY_PROBE_BUDGET);
  }
  return Math.max(0, requested);
}

/** First archive hour always runs; later hours respect the job deadline. */
export function shouldFetchAnotherArchiveHour(
  alreadyFetchedOne: boolean,
  nowMs: number,
  deadlineMs: number,
): boolean {
  if (!alreadyFetchedOne) return true;
  return nowMs < deadlineMs;
}

export function looksLikeResultCap(count: number): boolean {
  return count === 500 || count === 1000 || count === 2000;
}
