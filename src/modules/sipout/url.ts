/**
 * The only SipOut URLs this release builds.
 * The key is a query parameter. Callers must not log the result.
 */

export const SIPOUT_ORIGIN = "https://lk.sipout.net";

const USERAPI_PATH = "/userapi/";
const CITY_ID = /^\d{1,12}$/;

export type SipoutRead =
  | { action: "get_cities" }
  | { action: "connected_list" }
  | { action: "free_list"; cityId: string };

/** Null when the read is not one of the three handbook calls. */
export function sipoutUrl(key: string, read: SipoutRead): string | null {
  if (!key) return null;
  let url: URL;
  try {
    url = new URL(USERAPI_PATH, `${SIPOUT_ORIGIN}/`);
  } catch {
    return null;
  }
  if (url.origin !== SIPOUT_ORIGIN) return null;
  url.search = "";
  url.hash = "";
  url.username = "";
  url.password = "";
  url.searchParams.set("key", key);
  url.searchParams.set("method", "did");
  url.searchParams.set("action", read.action);
  if (read.action === "free_list") {
    if (!CITY_ID.test(read.cityId)) return null;
    url.searchParams.set("city_id", read.cityId);
  }
  if (url.pathname !== USERAPI_PATH) return null;
  return url.href;
}
