/**
 * Addresses the outbound probe may connect to.
 * Private relays are allowed. Loopback, link-local, and multicast are not.
 */

import { BlockList, isIP } from "node:net";

const BLOCKED = new BlockList();

function block4(address: string, prefix: number): void {
  BLOCKED.addSubnet(address, prefix, "ipv4");
}

function block6(address: string, prefix: number): void {
  BLOCKED.addSubnet(address, prefix, "ipv6");
}

block4("0.0.0.0", 8);
block4("127.0.0.0", 8);
block4("169.254.0.0", 16);
block4("224.0.0.0", 4);
block4("255.255.255.255", 32);
block6("::", 128);
block6("::1", 128);
block6("fe80::", 10);
block6("ff00::", 8);

export function isMailAddressAllowed(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 0) return false;
  if (ip.toLowerCase().startsWith("::ffff:")) {
    const tail = ip.slice(ip.lastIndexOf(":") + 1);
    return isMailAddressAllowed(tail);
  }
  return !BLOCKED.check(ip, kind === 6 ? "ipv6" : "ipv4");
}

export const MAIL_DNS_LIMIT = 16;

export function chooseMailAddress(
  v4: string[],
  v6: string[],
): { ok: true; address: string; family: 4 | 6 } | { ok: false } {
  if (v4.length + v6.length === 0 || v4.length + v6.length > MAIL_DNS_LIMIT) {
    return { ok: false };
  }
  if ([...v4, ...v6].some((ip) => !isMailAddressAllowed(ip))) return { ok: false };
  if (v4.length > 0) return { ok: true, address: v4[0] ?? "", family: 4 };
  return { ok: true, address: v6[0] ?? "", family: 6 };
}
