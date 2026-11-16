/**
 * MCN Telecom reads. The hosts, paths, and query fields are literals.
 * GET only. The token is not a query field.
 */

export const SHOP_ORIGIN = "https://shop.mcn.ru";
export const VPBX_ORIGIN = "https://vpbx.mcn.ru";
export const SHOP_HOST = "shop.mcn.ru";
export const VPBX_HOST = "vpbx.mcn.ru";
export const MCN_PROVIDER = "MCN Telecom";
export const FREE_PAGE_LIMIT = 2000;
export const FREE_PROBE_LIMIT = 25;
export const PURCHASED_LIMIT = 100;
export const OFFSET_MAX = 5_000_000;

const PURCHASED_PATH = "/api/protected/phone/composite-dids";
const COUNTRIES_PATH = "/api/protected/showcase/countries";
const NUMBERS_PATH = "/api/protected/showcase/numbers";

const ALLOWED: Record<string, ReadonlySet<string>> = {
  [SHOP_HOST]: new Set([COUNTRIES_PATH, NUMBERS_PATH]),
  [VPBX_HOST]: new Set([PURCHASED_PATH]),
};

export function offsetTooFar(offset: number): boolean {
  return !Number.isSafeInteger(offset) || offset < 0 || offset > OFFSET_MAX;
}

export function freePageTooFar(pageNumber: number): boolean {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) return true;
  return (pageNumber - 1) * FREE_PAGE_LIMIT > OFFSET_MAX;
}

export function purchasedUrl(offset: number, limit: number): string | null {
  if (!Number.isSafeInteger(offset) || offset < 0) return null;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > PURCHASED_LIMIT) return null;
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    type: "common",
  });
  return `${VPBX_ORIGIN}${PURCHASED_PATH}?${query.toString()}`;
}

export function countriesUrl(): string {
  return `${SHOP_ORIGIN}${COUNTRIES_PATH}`;
}

export function freeUrl(
  countryCode: number,
  pageNumber: number,
  limit: number,
): string | null {
  if (limit !== FREE_PAGE_LIMIT && limit !== FREE_PROBE_LIMIT) return null;
  if (!Number.isSafeInteger(countryCode) || countryCode < 0) return null;
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) return null;
  const query = new URLSearchParams({
    countryCode: String(countryCode),
    limitPerPage: String(limit),
    pageNumber: String(pageNumber),
  });
  return `${SHOP_ORIGIN}${NUMBERS_PATH}?${query.toString()}`;
}

/** HTTPS request fields. The Authorization header is added by the caller. */
export function platformRequest(url: string): {
  hostname: string;
  method: "GET";
  path: string;
  servername: string;
} | null {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  const allowed = ALLOWED[target.hostname];
  if (target.protocol !== "https:" || !allowed || !allowed.has(target.pathname))
    return null;
  if (target.username || target.password) return null;
  if (target.port && target.port !== "443") return null;
  return {
    hostname: target.hostname,
    method: "GET",
    path: `${target.pathname}${target.search}`,
    servername: target.hostname,
  };
}

export function authorizationHeader(token: string): string {
  return `Bearer ${token}`;
}
