import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { AuthError } from "@/modules/auth/errors";
import {
  type AuthzContext,
  type SessionAuthzContext,
  requireAuthz,
  requirePermission,
  requireApiAuthzPermission,
} from "@/modules/auth/session";
import type { PermissionCode } from "@/modules/rbac/permissions";

/**
 * Server Component / layout guard: redirect anonymous → login, forbidden → /forbidden.
 */
export async function requirePagePermission(
  permission: PermissionCode,
): Promise<SessionAuthzContext> {
  try {
    return await requirePermission(permission);
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.code === "UNAUTHORIZED" || error.code === "INACTIVE") {
        redirect(
          error.code === "INACTIVE" ? "/login?reason=inactive" : "/login",
        );
      }
      redirect("/forbidden");
    }
    throw error;
  }
}

/**
 * Server Component guard: any authenticated (active) user.
 */
export async function requirePageSession(): Promise<SessionAuthzContext> {
  try {
    return await requireAuthz();
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(
        error.code === "INACTIVE" ? "/login?reason=inactive" : "/login",
      );
    }
    throw error;
  }
}

type ApiGuardOk = { ok: true; ctx: AuthzContext };
type ApiGuardFail = { ok: false; response: NextResponse };

function mapAuthErrorToResponse(error: AuthError): NextResponse {
  if (error.code === "UNAUTHORIZED" || error.code === "INACTIVE") {
    return NextResponse.json(
      { error: "Unauthorized", code: error.code },
      { status: 401 },
    );
  }
  if (error.code === "RATE_LIMITED") {
    return NextResponse.json(
      { error: "Too many requests", code: "RATE_LIMITED" },
      { status: 429 },
    );
  }
  return NextResponse.json(
    { error: "Forbidden", code: "FORBIDDEN" },
    { status: 403 },
  );
}

/**
 * Route Handler guard: session cookie OR API key.
 * Returns 401/403/429 JSON instead of redirecting.
 */
export async function requireApiPermission(
  permission: PermissionCode,
): Promise<ApiGuardOk | ApiGuardFail> {
  try {
    const ctx = await requireApiAuthzPermission(permission);
    return { ok: true, ctx };
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, response: mapAuthErrorToResponse(error) };
    }
    throw error;
  }
}

export async function requireApiSession(): Promise<
  { ok: true; ctx: SessionAuthzContext } | ApiGuardFail
> {
  try {
    const ctx = await requireAuthz();
    return { ok: true, ctx };
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, response: mapAuthErrorToResponse(error) };
    }
    throw error;
  }
}
