/** Battle-tested Collector defaults — not exposed in Settings v1. */

export const CALL_ID_WINDOW_MS = 30 * 60 * 1000;
export const FALLBACK_WINDOW_MS = 2 * 60 * 1000;
export const FALLBACK_WINDOW_MAX_MS = 10 * 60 * 1000;
export const MIN_SCORE = 60;
export const DISAMBIGUITY_MARGIN = 8;
export const NUMBER_SUFFIX_LEN = 10;
export const RATE_LIMIT_PER_SEC = 20;
export const HTTP_TIMEOUT_MS = 60_000;
export const MAX_RESPONSE_BYTES = 32 << 20;

export const RANGE_SLICE_MS = 15 * 60 * 1000;
export const RANGE_MIN_SLICE_MS = 60 * 1000;
export const RANGE_FETCH_CONCURRENCY = 10;
/** Exact result counts that look like a silent API page cap. */
export const RANGE_SLICE_CAP_COUNTS = [500, 1000, 2000] as const;

export const GRACE_MS = 15_000;
export const LIVE_PRIORITY_MS = 24 * 60 * 60 * 1000;
export const MAX_CANDIDATES_PER_HOUR = 8000;
export const WRITE_CHUNK_SIZE = 2000;
export const JOB_BUDGET_MS = 2 * 60 * 1000;

export const LIVE_PROBE_BUDGET = 32;
export const ARCHIVE_RETRY_PROBE_BUDGET = 16;

export const RETRY_BACKOFF_MS = [
  15_000, 60_000, 5 * 60_000, 15 * 60_000,
] as const;

/** Stop retrying "not found in VM" misses. assigned_elsewhere / api_error stay in queue. */
export const MAX_MATCH_ATTEMPTS = 12;

export const EVIDENCE_JSON_MAX_CHARS = 2048;

export const SATEL_CALL_ID_FIELDS = [
  "outLegCallId",
  "srcOutLegCallId",
  "inLegCallId",
  "srcInLegCallId",
  "srcInLegConfId",
  "confId",
] as const;
