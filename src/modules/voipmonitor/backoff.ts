import {
  EVIDENCE_JSON_MAX_CHARS,
  QUEUE_EXHAUSTED_AT,
  RETRY_BACKOFF_MS,
} from "@/modules/voipmonitor/constants";
import { isTerminalNotFoundExhausted } from "@/modules/voipmonitor/queue-filter";
import {
  STATUS_MATCHED_EXACT,
  STATUS_MATCHED_FALLBACK,
  type MatchResult,
} from "@/modules/voipmonitor/types";

export function isMatchedStatus(status: string): boolean {
  return status === STATUS_MATCHED_EXACT || status === STATUS_MATCHED_FALLBACK;
}

export function nextAttemptAt(attemptCount: number, now = new Date()): Date {
  const index = Math.min(
    Math.max(0, attemptCount - 1),
    RETRY_BACKOFF_MS.length - 1,
  );
  return new Date(now.getTime() + RETRY_BACKOFF_MS[index]!);
}

/** Backoff, or a far-future sentinel so exhausted not-found leave the due queue. */
export function nextAttemptAtForMiss(
  attemptCount: number,
  evidenceJson: string,
  now = new Date(),
): Date {
  if (isTerminalNotFoundExhausted(attemptCount, evidenceJson)) {
    return QUEUE_EXHAUSTED_AT;
  }
  return nextAttemptAt(attemptCount, now);
}

export function compactEvidence(result: MatchResult): string {
  if (isMatchedStatus(result.status)) return "";
  const raw = result.evidenceJson || "{}";
  if (raw.length <= EVIDENCE_JSON_MAX_CHARS) return raw;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return JSON.stringify({
      miss_reason: result.missReason || parsed.miss_reason,
      stage: parsed.stage,
    }).slice(0, EVIDENCE_JSON_MAX_CHARS);
  } catch {
    return raw.slice(0, EVIDENCE_JSON_MAX_CHARS);
  }
}
