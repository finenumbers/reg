import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Lightweight edge gate:
 * - Unauthenticated browser hits on protected app routes → redirect /login
 * - Unauthenticated API (non-public) → 401 JSON
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
    if (!sessionCookie) {
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

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
