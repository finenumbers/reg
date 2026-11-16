/**
 * Voximplant Management API. The host and the methods are literals.
 * POST is the transport. The body stays empty. The token is not a query field.
 */

export const VOXIMPLANT_ORIGIN = "https://api.voximplant.com";
export const VOXIMPLANT_PROVIDER = "Voximplant";
export const FREE_COUNT = 50;
export const PURCHASED_COUNT = 100;
export const OFFSET_MAX = 5_000_000;
export const CATEGORY_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export function offsetTooFar(offset: number): boolean {
  return offset > OFFSET_MAX;
}

const HOST = "api.voximplant.com";

function endpoint(
  method:
    | "GetPhoneNumbers"
    | "GetPhoneNumberCategories"
    | "GetPhoneNumberRegions"
    | "GetNewPhoneNumbers",
  params: Record<string, string>,
): string {
  const query = new URLSearchParams(params);
  return `${VOXIMPLANT_ORIGIN}/platform_api/${method}?${query.toString()}`;
}

export function purchasedUrl(offset: number, count: number): string {
  return endpoint("GetPhoneNumbers", {
    count: String(count),
    offset: String(offset),
    sandbox: "false",
    order_by: "phone_number",
  });
}

export function categoriesUrl(): string {
  return endpoint("GetPhoneNumberCategories", {
    country_code: "RU",
    sandbox: "false",
    locale: "RU",
  });
}

export function regionsUrl(category: string): string | null {
  if (!CATEGORY_NAME.test(category)) return null;
  return endpoint("GetPhoneNumberRegions", {
    country_code: "RU",
    phone_category_name: category,
    locale: "RU",
    omit_empty: "true",
  });
}

export function freeUrl(
  category: string,
  regionId: number,
  offset: number,
  count: number,
): string | null {
  if (!CATEGORY_NAME.test(category)) return null;
  if (!Number.isSafeInteger(regionId) || regionId < 0) return null;
  return endpoint("GetNewPhoneNumbers", {
    country_code: "RU",
    phone_category_name: category,
    phone_region_id: String(regionId),
    count: String(count),
    offset: String(offset),
  });
}

/** HTTPS request fields. The Authorization header is added by the caller and is not part of the path. */
export function platformRequest(
  url: string,
): { hostname: string; method: "POST"; path: string; servername: string } | null {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.protocol !== "https:" || target.hostname !== HOST) return null;
  return {
    hostname: HOST,
    method: "POST",
    path: `${target.pathname}${target.search}`,
    servername: HOST,
  };
}
