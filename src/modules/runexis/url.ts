/**
 * Showcase reads. The query is page and limit only.
 */

export const RUNEXIS_ORIGIN = "https://didapi.runexis.ru";
export const SHOWCASE_LIMIT = 30;

export function loginUrl(): string {
  return `${RUNEXIS_ORIGIN}/api/v1/login`;
}

/** Null when the page is not a positive integer. No other query fields. */
export function showcaseUrl(page: number): string | null {
  if (!Number.isSafeInteger(page) || page < 1) return null;
  const url = new URL("/api/v1/numbers/showcase", RUNEXIS_ORIGIN);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(SHOWCASE_LIMIT));
  return url.toString();
}
