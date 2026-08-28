/** Battle-tested Collector defaults — not exposed in Settings v1. */

export const CALL_ID_WINDOW_MS = 30 * 60 * 1000;
export const FALLBACK_WINDOW_MS = 2 * 60 * 1000;
export const FALLBACK_WINDOW_MAX_MS = 10 * 60 * 1000;
export const MIN_SCORE = 60;
export const DISAMBIGUITY_MARGIN = 8;
export const NUMBER_SUFFIX_LEN = 10;
export const RATE_LIMIT_PER_SEC = 5;
export const HTTP_TIMEOUT_MS = 60_000;
export const MAX_RESPONSE_BYTES = 32 << 20;

export const GRACE_MS = 15_000;
export const LIVE_PRIORITY_MS = 24 * 60 * 60 * 1000;
export const MAX_CANDIDATES_PER_HOUR = 2000;
export const JOB_BUDGET_MS = 2 * 60 * 1000;

export const RETRY_BACKOFF_MS = [
  15_000, 60_000, 5 * 60_000, 15 * 60_000,
] as const;

export const EVIDENCE_JSON_MAX_CHARS = 2048;

export const SATEL_CALL_ID_FIELDS = [
  "outLegCallId",
  "srcOutLegCallId",
  "inLegCallId",
  "srcInLegCallId",
  "srcInLegConfId",
  "confId",
] as const;
