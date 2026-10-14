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

/** The outcome field only. `miss_reason_seed` is not a reason. */
export function missReasonOf(evidenceJson: string): string | null {
  try {
    const parsed = JSON.parse(evidenceJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const reason = (parsed as { miss_reason?: unknown }).miss_reason;
      if (typeof reason === "string") return reason;
    }
  } catch {
    // Truncated evidence is still scanned for the field below.
  }
  const match = /"miss_reason"\s*:\s*"([^"]*)"/.exec(evidenceJson);
  return match?.[1] ?? null;
}

export function isTerminalNotFoundExhausted(
  attemptCount: number,
  evidenceJson: string,
): boolean {
  if (attemptCount < MAX_MATCH_ATTEMPTS) return false;
  const reason = missReasonOf(evidenceJson);
  if (!reason) return false;
  return (TERMINAL_NOT_FOUND_MISS as readonly string[]).includes(reason);
}

/** Empty URL and due for retry now (exhausted not-found use a far-future nextAttemptAt). */
export function voipmonitorDueLinkWhere(now: Date) {
  return {
    voipmonitorUrl: "",
    OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
  };
}
