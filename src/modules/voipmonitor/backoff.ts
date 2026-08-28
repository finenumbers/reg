import {
  EVIDENCE_JSON_MAX_CHARS,
  RETRY_BACKOFF_MS,
} from "@/modules/voipmonitor/constants";
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
