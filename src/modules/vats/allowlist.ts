import { parseDomainName, parseTelnum } from "@/modules/vats/names";

export const BOSS_DOMAINS = "/sys/boss/v1/domains";
export const BOSS_TELNUMS = "/sys/boss/v1/telnums";
export const BOSS_GATEWAYS = "/sys/boss/v1/gateways";
export const BOSS_ROUTES = "/sys/boss/v1/routes";
export const BOSS_DIALPLANS = "/sys/boss/v1/dialplans";

const STATIC_GET = new Set([
  BOSS_DOMAINS,
  BOSS_TELNUMS,
  BOSS_GATEWAYS,
  BOSS_ROUTES,
  BOSS_DIALPLANS,
]);

function decodeSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Literal paths only. DELETE, POST, sessions, and nested writes are refused. */
export function bossRequestTarget(method: string, path: string): string | null {
  if (method !== "GET" && method !== "PUT") return null;
  if (!path.startsWith("/sys/boss/v1/")) return null;
  if (
    path.includes("..") ||
    path.includes("//") ||
    path.includes("?") ||
    path.includes("#")
  ) {
    return null;
  }
  if (method === "GET" && STATIC_GET.has(path)) return path;

  const domain = /^\/sys\/boss\/v1\/domains\/([^/]+)$/.exec(path);
  if (domain && (method === "GET" || method === "PUT")) {
    const name = decodeSegment(domain[1]);
    if (!name || parseDomainName(name) !== name) return null;
    return path;
  }

  const stat = /^\/sys\/boss\/v1\/domains\/([^/]+)\/stat$/.exec(path);
  if (stat && method === "GET") {
    const name = decodeSegment(stat[1]);
    if (!name || parseDomainName(name) !== name) return null;
    return path;
  }

  const telnum = /^\/sys\/boss\/v1\/telnums\/([^/]+)$/.exec(path);
  if (telnum && method === "GET") {
    const name = decodeSegment(telnum[1]);
    if (!name || parseTelnum(name) !== name) return null;
    return path;
  }

  return null;
}

export function domainPath(domain: string): string | null {
  const name = parseDomainName(domain);
  if (!name) return null;
  const path = `${BOSS_DOMAINS}/${encodeURIComponent(name)}`;
  return bossRequestTarget("GET", path) === path ? path : null;
}

/** Card path plus the literal `/stat`. The suffix is not taken from a caller. */
export function domainStatPath(domain: string): string | null {
  const name = parseDomainName(domain);
  if (!name) return null;
  const path = `${BOSS_DOMAINS}/${encodeURIComponent(name)}/stat`;
  return bossRequestTarget("GET", path) === path ? path : null;
}

export function telnumPath(telnum: string): string | null {
  const name = parseTelnum(telnum);
  if (!name) return null;
  const path = `${BOSS_TELNUMS}/${encodeURIComponent(name)}`;
  return bossRequestTarget("GET", path) === path ? path : null;
}
