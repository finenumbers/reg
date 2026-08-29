import { MAX_MATCH_ATTEMPTS } from "@/modules/voipmonitor/constants";
import {
  MISS_CALL_ID_NOT_IN_INDEX,
  MISS_EMPTY_CALLID_WEAK_SIGNAL,
  MISS_FALLBACK_BELOW_THRESHOLD,
  MISS_NO_CANDIDATES_IN_WINDOW,
} from "@/modules/voipmonitor/types";

/** Misses that mean "not in VoIPmonitor" — stop after MAX_MATCH_ATTEMPTS. */
export const TERMINAL_NOT_FOUND_MISS = [
  MISS_CALL_ID_NOT_IN_INDEX,
  MISS_EMPTY_CALLID_WEAK_SIGNAL,
  MISS_NO_CANDIDATES_IN_WINDOW,
  MISS_FALLBACK_BELOW_THRESHOLD,
] as const;

export function isTerminalNotFoundExhausted(
  attemptCount: number,
  evidenceJson: string,
): boolean {
  if (attemptCount < MAX_MATCH_ATTEMPTS) return false;
  return TERMINAL_NOT_FOUND_MISS.some((reason) => evidenceJson.includes(reason));
}

/** Empty URL and due for retry now (exhausted not-found use a far-future nextAttemptAt). */
export function voipmonitorDueLinkWhere(now: Date) {
  return {
    voipmonitorUrl: "",
    OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
  };
}
