import { isIP } from "node:net";
import { asRecord } from "@/modules/vats/card";
import type { BossAuth, BossResult } from "@/modules/vats/client";
import { parseDomainName } from "@/modules/vats/names";

export const CABINET_NAVIGATION = "Откройте кабинет из списка доменов.";
export const CABINET_MISSING = "Домен не найден.";
export const CABINET_LIMIT = "Слишком много открытий кабинета. Подождите минуту.";
export const CABINET_LINK_ERROR = "Платформа вернула не ссылку кабинета.";
export const CABINET_FAILED = "Не удалось открыть кабинет домена.";

export type CabinetOpenInput = {
  domain: string;
  userId: string;
  ip: string | null;
  appHosts: ReadonlySet<string>;
};

export type CabinetOpenResult =
  { ok: true; location: string } | { ok: false; status: number; error: string };

export type CabinetActor = { userId: string; ip: string | null };

export type CabinetIo = {
  creds: () => Promise<{ ok: true; auth: BossAuth } | { ok: false; error: string }>;
  member: (origin: string, domain: string) => Promise<boolean>;
  allow: (userId: string) => boolean;
  read: (auth: BossAuth, domain: string) => Promise<BossResult<unknown>>;
  audit: (domain: string, actor: CabinetActor) => Promise<void>;
};

type HeaderBag = { get(name: string): string | null };

/** A real navigation. Prefetch, fetch, and a foreign site do not pass. */
export function cabinetNavigation(headers: HeaderBag): boolean {
  if (headers.get("sec-fetch-mode") !== "navigate") return false;
  if (headers.get("sec-fetch-dest") !== "document") return false;
  const site = headers.get("sec-fetch-site");
  if (site !== "same-origin" && site !== "none") return false;
  const purpose = `${headers.get("purpose") ?? ""} ${headers.get("sec-purpose") ?? ""}`;
  if (purpose.toLowerCase().includes("prefetch")) return false;
  return true;
}

export function cabinetAppHosts(request: Request): Set<string> {
  const hosts = new Set<string>();
  const header = request.headers.get("host")?.trim().toLowerCase();
  if (header) hosts.add(header);
  const configured = process.env.BETTER_AUTH_URL;
  if (configured) {
    try {
      const host = new URL(configured).host.toLowerCase();
      if (host) hosts.add(host);
    } catch {
      // A bad public URL does not add a host.
    }
  }
  return hosts;
}

function blockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }
  return isIP(host) !== 0;
}

function sameApp(url: URL, appHosts: ReadonlySet<string>): boolean {
  const host = url.host.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  for (const item of appHosts) {
    const value = item.trim().toLowerCase();
    if (value === host || value === hostname) return true;
  }
  return false;
}

/** The `link` string only. Other fields are ignored. */
export function cabinetLocation(
  data: unknown,
  appHosts: ReadonlySet<string>,
): string | null {
  const record = asRecord(data);
  if (!record || typeof record.link !== "string") return null;
  const raw = record.link;
  if (raw.length === 0 || raw.length > 2048 || /[\u0000-\u0020\\]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (blockedHost(url.hostname)) return null;
  if (sameApp(url, appHosts)) return null;
  if (url.href.length > 2048) return null;
  return url.href;
}

export function cabinetAuditMeta(domain: string): { domain: string } {
  return { domain };
}

/** Fixed phrases only. A domain name or a URL is replaced. */
export function cabinetErrorText(error: string, domain = ""): string {
  if (
    error.length > 180 ||
    /https?:|[\r\n<>]/i.test(error) ||
    /\blink\b/i.test(error) ||
    (domain.length > 0 && error.includes(domain))
  ) {
    return CABINET_FAILED;
  }
  return error;
}

/**
 * Membership, then the rate limit, then one read. The read holds the Boss
 * lock. A refusal before the read does not spend the limit.
 */
export async function runCabinetOpen(
  input: CabinetOpenInput,
  io: CabinetIo,
): Promise<CabinetOpenResult> {
  if (parseDomainName(input.domain) !== input.domain) {
    return { ok: false, status: 400, error: "Недопустимое имя домена." };
  }
  const creds = await io.creds();
  if (!creds.ok) return { ok: false, status: 400, error: creds.error };
  if (!(await io.member(creds.auth.origin, input.domain))) {
    return { ok: false, status: 404, error: CABINET_MISSING };
  }
  if (!io.allow(input.userId)) {
    return { ok: false, status: 429, error: CABINET_LIMIT };
  }
  const response = await io.read(creds.auth, input.domain);
  if (!response.ok) return { ok: false, status: 502, error: response.error };
  const location = cabinetLocation(response.data, input.appHosts);
  if (!location) return { ok: false, status: 502, error: CABINET_LINK_ERROR };
  try {
    await io.audit(input.domain, { userId: input.userId, ip: input.ip });
  } catch {
    // The journal must not cancel the redirect.
  }
  return { ok: true, location };
}
