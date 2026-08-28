import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

function hasMachineApiKey(request: NextRequest): boolean {
  const auth = request.headers.get("authorization");
  if (auth && /^Bearer\s+\S+/i.test(auth.trim())) return true;
  const x = request.headers.get("x-api-key");
  return Boolean(x?.trim());
}

/**
 * Lightweight edge gate:
 * - Unauthenticated browser hits on protected app routes → redirect /login
 * - Unauthenticated API (non-public) → 401 JSON
 * - API with Bearer / X-Api-Key passes through (validated in route handlers)
 * Full permission checks happen in server layouts / route handlers.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = getSessionCookie(request);

  const isAuthPage = pathname.startsWith("/login");
  const isForbiddenPage = pathname === "/forbidden";
  const isPublicApi =
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/healthz") ||
    pathname.startsWith("/api/readyz");

  if (isPublicApi || isForbiddenPage) {
    return NextResponse.next();
  }

  const isApi = pathname.startsWith("/api/");
  if (isApi) {
    if (!sessionCookie && !hasMachineApiKey(request)) {
      return NextResponse.json(
        { error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 },
      );
    }
    return NextResponse.next();
  }

  const isProtectedApp =
    pathname === "/" ||
    pathname.startsWith("/regs") ||
    pathname.startsWith("/phones") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/jobs") ||
    pathname.startsWith("/audit");

  if (!sessionCookie && isProtectedApp) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (!sessionCookie && !isAuthPage) {
    // Unknown app paths still require a session cookie.
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Do not bounce cookie holders off /login — inactive sessions must be
  // able to land there without a /login ↔ / redirect loop.

  return NextResponse.next();
}

/** Shared with tests. Do not run middleware on enrich upload (Next clones the body at 10MiB). */
export const MIDDLEWARE_MATCHER =
  "/((?!_next/static|_next/image|favicon.ico|api/enrich(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)";

export function middlewareMatcherHits(pathname: string): boolean {
  const re = new RegExp(`^${MIDDLEWARE_MATCHER}$`);
  return re.test(pathname);
}

export const config = {
  matcher: [MIDDLEWARE_MATCHER],
};
