/**
 * One saved Aurora link. The address is http or https, with no login and no fragment.
 * A private or local target is rejected before any connection.
 */

import { BlockList, isIP } from "node:net";

export const AURORA_URL_LIMIT = 2000;

const BLOCKED = new BlockList();

function block4(address: string, prefix: number): void {
  BLOCKED.addSubnet(address, prefix, "ipv4");
}

function block6(address: string, prefix: number): void {
  BLOCKED.addSubnet(address, prefix, "ipv6");
}

block4("0.0.0.0", 8);
block4("10.0.0.0", 8);
block4("100.64.0.0", 10);
block4("127.0.0.0", 8);
block4("169.254.0.0", 16);
block4("172.16.0.0", 12);
block4("192.0.0.0", 24);
block4("192.0.2.0", 24);
block4("192.88.99.0", 24);
block4("192.168.0.0", 16);
block4("198.18.0.0", 15);
block4("198.51.100.0", 24);
block4("203.0.113.0", 24);
block4("224.0.0.0", 4);
block6("::", 128);
block6("::1", 128);
block6("64:ff9b::", 96);
block6("100::", 64);
block6("2001:db8::", 32);
block6("fc00::", 7);
block6("fe80::", 10);
block6("fec0::", 10);
block6("ff00::", 8);

export type AuroraUrl = { href: string; host: string; port: string };

const ADDRESS_ERROR = "Укажите ссылку http или https.";

export function isGlobalAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 0) return false;
  const type = kind === 6 ? "ipv6" : "ipv4";
  if (BLOCKED.check(ip, type)) return false;
  const mapped = ip.toLowerCase().startsWith("::ffff:");
  if (!mapped) return true;
  const tail = ip.slice(ip.lastIndexOf(":") + 1);
  if (isIP(tail) !== 4) return false;
  return isGlobalAddress(tail);
}

function localName(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, "");
  return name === "localhost" || name.endsWith(".localhost") || name.endsWith(".local");
}

/** The address that will be requested. The fragment and the login are rejected. */
export function canonicalizeAuroraUrl(
  raw: string,
): ({ ok: true } & AuroraUrl) | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (
    !trimmed ||
    trimmed.length > AURORA_URL_LIMIT ||
    /[\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    return { ok: false, error: ADDRESS_ERROR };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: ADDRESS_ERROR };
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.hash ||
    !url.hostname
  ) {
    return { ok: false, error: ADDRESS_ERROR };
  }
  const bare =
    url.hostname.startsWith("[") && url.hostname.endsWith("]")
      ? url.hostname.slice(1, -1)
      : url.hostname;
  if (!bare || localName(bare) || (isIP(bare) !== 0 && !isGlobalAddress(bare))) {
    return { ok: false, error: "Ссылка ведёт на закрытый адрес." };
  }
  url.hash = "";
  return { ok: true, href: url.href, host: bare, port: url.port };
}

/** Host shown to the operator. A non-default port is included. The scheme and the path are not. */
export function auroraEndpointLabel(host: string, port: string): string {
  const bare = host.replace(/[\r\n]+/g, "").slice(0, 253);
  if (!/^[1-9]\d{0,4}$/.test(port)) return bare;
  if (bare.includes(":")) return `[${bare}]:${port}`;
  return `${bare}:${port}`;
}

/** Operator text. A fetch error can contain the full address, so that text is dropped. */
export function auroraOperatorError(index: number, host: string, detail: string): string {
  const text = detail
    .replace(/Файл Ссылка \d+(?:, строка \d+)?:\s*/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[\r\n]+/g, " ")
    .trim();
  const safeHost = host.replace(/[\r\n]+/g, "").slice(0, 253);
  return `Ссылка ${index + 1} (${safeHost}): ${text || "не удалось скачать."}`;
}
