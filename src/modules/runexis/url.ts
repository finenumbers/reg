/**
 * DIDAPI reads. Management is page and limit only.
 * The showcase is one three-digit code from the code directory.
 */

export const RUNEXIS_ORIGIN = "https://didapi.runexis.ru";
export const SHOWCASE_LIMIT = 30;

export type RunexisList = "showcase" | "management";

export type CodeSlice = {
  code: string;
  cityId: number | null;
};

export function loginUrl(): string {
  return `${RUNEXIS_ORIGIN}/api/v1/login`;
}

export function refreshUrl(): string {
  return `${RUNEXIS_ORIGIN}/api/v1/refresh`;
}

export function codesUrl(): string {
  return `${RUNEXIS_ORIGIN}/api/v1/regions/codes`;
}

/** Null when the page is not a positive integer. No other query fields. */
export function catalogUrl(list: "management", page: number): string | null {
  if (list !== "management") return null;
  if (!Number.isSafeInteger(page) || page < 1) return null;
  const url = new URL("/api/v1/numbers/management", RUNEXIS_ORIGIN);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(SHOWCASE_LIMIT));
  return url.toString();
}

/** One code. city_ids[] only when that directory row has an integer city id. */
export function showcaseSliceUrl(page: number, slice: CodeSlice): string | null {
  if (!Number.isSafeInteger(page) || page < 1) return null;
  if (!/^\d{3}$/.test(slice.code)) return null;
  if (slice.cityId != null && (!Number.isSafeInteger(slice.cityId) || slice.cityId < 0)) {
    return null;
  }
  const url = new URL("/api/v1/numbers/showcase", RUNEXIS_ORIGIN);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(SHOWCASE_LIMIT));
  if (slice.cityId != null) url.searchParams.append("city_ids[]", String(slice.cityId));
  url.searchParams.append("region_codes[0][]", slice.code);
  return url.toString();
}
