import { headers } from "next/headers";

type HeaderBag = { get(name: string): string | null };

/**
 * Client IP for login and API-key failure limits.
 * Prefer the proxy's X-Real-IP. Otherwise the last X-Forwarded-For hop,
 * and only when the public URL is HTTPS.
 */
export function trustedClientIp(headers: HeaderBag | undefined): string | null {
  if (!headers) return null;
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded && process.env.BETTER_AUTH_URL?.startsWith("https://")) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1]!;
  }

  return null;
}

/** Best-effort client IP for audit (proxied via NPM / local). */
export async function getRequestIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip");
}
