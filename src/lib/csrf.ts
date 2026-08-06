/**
 * Same-origin / CSRF hardening for cookie-authenticated mutating APIs.
 *
 * Better Auth sessions use httpOnly cookies. Browsers send Origin on
 * cross-site form/fetch POSTs; we require Origin (or Referer) to match
 * this app's expected origin derived from BETTER_AUTH_URL / Host.
 */

import { NextResponse } from "next/server";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function parseOrigin(value: string | null): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function originFromReferer(referer: string | null): URL | null {
  const url = parseOrigin(referer);
  if (!url) return null;
  return new URL(`${url.protocol}//${url.host}`);
}

function expectedOrigins(request: Request): Set<string> {
  const origins = new Set<string>();
  const authUrl = process.env.BETTER_AUTH_URL;
  if (authUrl) {
    const parsed = parseOrigin(authUrl);
    if (parsed) origins.add(`${parsed.protocol}//${parsed.host}`);
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (parseOrigin(authUrl ?? null)?.protocol.replace(":", "") || "http");
  if (host) {
    origins.add(`${proto}://${host}`);
  }

  // Always allow the request URL's own origin (covers local / relative base).
  try {
    const reqUrl = new URL(request.url);
    origins.add(`${reqUrl.protocol}//${reqUrl.host}`);
  } catch {
    // ignore
  }

  return origins;
}

export type SameOriginResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Pure check — useful in unit tests without NextResponse.
 */
export function checkSameOrigin(request: Request): SameOriginResult {
  if (!MUTATING.has(request.method.toUpperCase())) {
    return { ok: true };
  }

  const allowed = expectedOrigins(request);
  const originHeader = request.headers.get("origin");
  const origin = parseOrigin(originHeader) ?? originFromReferer(request.headers.get("referer"));

  if (!origin) {
    // Missing Origin/Referer on a cookie-authenticated mutation is suspicious
    // (classic CSRF from non-browser or carefully stripped browser). Reject.
    return { ok: false, reason: "Missing Origin or Referer on mutating request" };
  }

  const candidate = `${origin.protocol}//${origin.host}`;
  if (!allowed.has(candidate)) {
    return { ok: false, reason: "Origin does not match application host" };
  }

  return { ok: true };
}

export function assertSameOrigin(
  request: Request,
): { ok: true } | { ok: false; response: NextResponse } {
  const result = checkSameOrigin(request);
  if (result.ok) return { ok: true };
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: "Forbidden origin",
        code: "CSRF_ORIGIN",
        detail: result.reason,
      },
      { status: 403 },
    ),
  };
}
