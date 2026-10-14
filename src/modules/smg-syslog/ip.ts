/**
 * Canonical IPv4 for SMG syslog source addresses.
 * Leading zeros are rejected so 010.0.0.1 cannot name a different directory.
 */

const MAPPED_PREFIX = "::ffff:";

function parseOctet(text: string): number | null {
  if (!/^(?:0|[1-9]\d{0,2})$/.test(text)) return null;
  const value = Number(text);
  if (value > 255) return null;
  return value;
}

/** Dotted IPv4, or null when the text is not a canonical address. */
export function canonicalIpv4(address: string): string | null {
  let text = address.trim().toLowerCase();
  if (text.startsWith(MAPPED_PREFIX)) text = text.slice(MAPPED_PREFIX.length);
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    const octet = parseOctet(part);
    if (octet == null) return null;
    octets.push(octet);
  }
  return octets.join(".");
}

/** Typical docker-proxy / bridge gateway (172.16.0.0/12, host .0.1). */
export function looksLikeDockerBridge(ip: string): boolean {
  const match = /^172\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (!match) return false;
  const second = Number(match[1]);
  return second >= 16 && second <= 31 && match[2] === "0" && match[3] === "1";
}
