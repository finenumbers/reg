import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { AuthError } from "@/modules/auth/errors";
import {
  type AuthzContext,
  requireAuthz,
  requirePermission,
} from "@/modules/auth/session";
import type { PermissionCode } from "@/modules/rbac/permissions";

/**
 * Server Component / layout guard: redirect anonymous → login, forbidden → /forbidden.
 */
export async function requirePagePermission(
  permission: PermissionCode,
): Promise<AuthzContext> {
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
export async function requirePageSession(): Promise<AuthzContext> {
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

/**
 * Route Handler guard: returns 401/403 JSON instead of redirecting.
 */
export async function requireApiPermission(
  permission: PermissionCode,
): Promise<ApiGuardOk | ApiGuardFail> {
  try {
    const ctx = await requirePermission(permission);
    return { ok: true, ctx };
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.code === "UNAUTHORIZED" || error.code === "INACTIVE") {
        return {
          ok: false,
          response: NextResponse.json(
            { error: "Unauthorized", code: error.code },
            { status: 401 },
          ),
        };
      }
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Forbidden", code: "FORBIDDEN" },
          { status: 403 },
        ),
      };
    }
    throw error;
  }
}

export async function requireApiSession(): Promise<ApiGuardOk | ApiGuardFail> {
  try {
    const ctx = await requireAuthz();
    return { ok: true, ctx };
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Unauthorized", code: error.code },
          { status: 401 },
        ),
      };
    }
    throw error;
  }
}
