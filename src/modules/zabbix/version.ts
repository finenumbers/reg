/** How a Zabbix session token is sent after user.login. */

export type ZabbixAuthKind = "auth" | "bearer";

/**
 * 6.0 through 7.0 keep the token in the JSON `auth` field.
 * Apache often drops Authorization, so Bearer is not used there.
 * 7.2 removed `auth`. Older than 6.0 is refused without a second login.
 */
export function zabbixAuthKind(version: string): ZabbixAuthKind | null {
  const match = /^(\d+)\.(\d+)(?:\D|$)/.exec(version.trim());
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return null;
  if (major < 6) return null;
  if (major > 7 || (major === 7 && minor >= 2)) return "bearer";
  return "auth";
}

/** Session ids are hex. Anything else is not put on a header. */
export function zabbixSessionToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!/^[0-9a-f]{16,128}$/i.test(value)) return null;
  return value;
}
