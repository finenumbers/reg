/**
 * DID catalog read contract. The token is DID's ADMIN_API_TOKEN.
 * Calls go to the UI host proxy, never to a caller-supplied path.
 */

export const DEFAULT_DID_BASE_URL = "https://did.finenumbers.com";
/** Same-host Docker DNS (Reg app and did-frontend on the `proxy` network). */
export const SAME_HOST_DID_BASE_URL = "http://did-frontend:3000";
export const DID_API_PREFIX = "/api/backend/api/v1";
export const DID_LIST_TIMEOUT_MS = 30_000;
export const DID_TEST_TIMEOUT_MS = 45_000;
export const DID_UNREACHABLE_HINT =
  "DID: не достучались до URL. Если сервис на этом же Docker-хосте, укажите http://did-frontend:3000";
export const DID_TIMEOUT_MESSAGE = "DID не ответил вовремя";
export const DID_UNAUTHORIZED_MESSAGE = "Неверный API-токен DID";
export const DID_UNAVAILABLE_MESSAGE = "DID временно недоступен";
export const DID_NOT_CONFIGURED_MESSAGE = "Сначала сохраните API-токен DID в Настройках";

export const DID_API_PATHS = ["/numbers/free", "/numbers/free/facets"] as const;

export type DidApiPath = (typeof DID_API_PATHS)[number];

const DID_API_PATH_SET = new Set<string>(DID_API_PATHS);

export function isDidApiPath(path: string): path is DidApiPath {
  return DID_API_PATH_SET.has(path);
}

export type DidCredentials = {
  baseUrl: string;
  apiToken: string;
};

export function normalizeDidBaseUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("DID URL must be http(s)");
  }
  if (url.username || url.password) {
    throw new Error("DID URL must not include credentials");
  }
  return `${url.protocol}//${url.host}`;
}

export function resolveDidBaseUrl(raw: string | null | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return DEFAULT_DID_BASE_URL;
  try {
    return normalizeDidBaseUrl(trimmed);
  } catch {
    return DEFAULT_DID_BASE_URL;
  }
}

/** Fixed paths only. A caller cannot point this at sync, wipe, export, or settings. */
export function didApiUrl(
  baseUrl: string,
  path: DidApiPath,
  params: URLSearchParams,
): string {
  if (!isDidApiPath(path)) {
    throw new Error("DID path is not allowed");
  }
  const origin = normalizeDidBaseUrl(baseUrl);
  const query = params.toString();
  const root = `${origin}${DID_API_PREFIX}${path}`;
  return query ? `${root}?${query}` : root;
}

/** DID wraps the value in ILIKE and treats backslash as the escape character. */
export function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
