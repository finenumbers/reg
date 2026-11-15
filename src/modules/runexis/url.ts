/**
 * DIDAPI reads. The query on a catalog page is page and limit only.
 */

export const RUNEXIS_ORIGIN = "https://didapi.runexis.ru";
export const SHOWCASE_LIMIT = 30;

export type RunexisList = "showcase" | "management";

export function loginUrl(): string {
  return `${RUNEXIS_ORIGIN}/api/v1/login`;
}

export function refreshUrl(): string {
  return `${RUNEXIS_ORIGIN}/api/v1/refresh`;
}

/** Null when the page is not a positive integer. No other query fields. */
export function catalogUrl(list: RunexisList, page: number): string | null {
  if (!Number.isSafeInteger(page) || page < 1) return null;
  const path =
    list === "showcase" ? "/api/v1/numbers/showcase" : "/api/v1/numbers/management";
  const url = new URL(path, RUNEXIS_ORIGIN);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(SHOWCASE_LIMIT));
  return url.toString();
}

export function showcaseUrl(page: number): string | null {
  return catalogUrl("showcase", page);
}
