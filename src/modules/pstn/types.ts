/**
 * PSTN Analytics external lookup — operator / GAR territory by 10-digit phone.
 */

export const PSTN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const PSTN_LOOKUP_TIMEOUT_MS = 10_000;
export const PSTN_TEST_TIMEOUT_MS = 15_000;
export const PSTN_LOOKUP_CONCURRENCY = 8;
export const PSTN_TEST_PHONE = "4996660000";
export const DEFAULT_PSTN_BASE_URL = "https://pstn.finenumbers.com";
/** Same-host Docker DNS (Reg + PSTN on the `proxy` network). */
export const SAME_HOST_PSTN_BASE_URL = "http://pstn_app:5555";
export const PSTN_UNREACHABLE_HINT =
  "PSTN: не достучались до URL. Если сервис на этом же Docker-хосте, укажите http://pstn_app:5555";
export const PSTN_CACHE_PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export type PstnFields = {
  found: boolean;
  operator: string | null;
  garTerritory: string | null;
};

export type PstnCredentials = {
  baseUrl: string;
  apiKey: string;
};

export function isPstnCacheFresh(
  lookedUpAt: Date,
  now: Date = new Date(),
): boolean {
  return now.getTime() - lookedUpAt.getTime() < PSTN_CACHE_TTL_MS;
}

export function normalizePstnBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  const url = new URL(trimmed);
  return `${url.protocol}//${url.host}`;
}

export function resolvePstnBaseUrl(raw: string | null | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return DEFAULT_PSTN_BASE_URL;
  try {
    return normalizePstnBaseUrl(trimmed);
  } catch {
    return DEFAULT_PSTN_BASE_URL;
  }
}

export function pstnLookupUrl(baseUrl: string, phone: string): string {
  const origin = normalizePstnBaseUrl(baseUrl);
  return `${origin}/api/v1/lookup?phone=${encodeURIComponent(phone)}`;
}

/** Digits only; 11 digits starting 7/8 → drop first; else exactly 10 or null. */
export function normalizePstnPhone(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) {
    return digits.slice(1);
  }
  if (digits.length === 10) return digits;
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function mapPstnLookupResponse(body: unknown): PstnFields {
  const root = asRecord(body) ?? {};
  if (root.found === false) {
    return { found: false, operator: null, garTerritory: null };
  }
  const data = asRecord(root.data);
  const operator = asNullableString(data?.operator);
  const garTerritory = asNullableString(data?.garTerritory);
  return {
    found: root.found === true && Boolean(operator),
    operator,
    garTerritory,
  };
}
