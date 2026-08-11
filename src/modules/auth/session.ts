import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/modules/auth/auth";
import { AuthError } from "@/modules/auth/errors";
import {
  getUserAuthz,
  type UserAuthz,
} from "@/modules/rbac/service";
import { hasPermission, type PermissionCode } from "@/modules/rbac/permissions";
import { prisma } from "@/lib/db";
import {
  authenticateApiKey,
} from "@/modules/api-keys/service";
import { extractApiKeyFromHeaders } from "@/modules/api-keys/crypto";
import { apiKeyRateLimiter } from "@/lib/rate-limit";

export type AuthSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>;

export type SessionAuthzContext = {
  authKind: "session";
  session: AuthSession;
  apiKeyId: null;
  authz: UserAuthz;
  username: string | null;
};

export type ApiKeyAuthzContext = {
  authKind: "api_key";
  session: null;
  apiKeyId: string;
  authz: UserAuthz;
  username: null;
};

export type AuthzContext = SessionAuthzContext | ApiKeyAuthzContext;

async function getSession(): Promise<AuthSession | null> {
  return auth.api.getSession({
    headers: await headers(),
  });
}

/**
 * Session + RBAC + active-user check. Returns null when anonymous.
 * Throws AuthError("INACTIVE") when the account is disabled.
 */
async function getSessionAuthzContext(): Promise<SessionAuthzContext | null> {
  const session = await getSession();
  if (!session) return null;

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isActive: true, username: true },
  });

  if (!dbUser) {
    throw new AuthError("UNAUTHORIZED");
  }

  if (dbUser.isActive === false) {
    throw new AuthError("INACTIVE", "User account is inactive");
  }

  const authz = await getUserAuthz(session.user.id);
  const username =
    dbUser.username ??
    (session.user as { username?: string | null }).username ??
    null;

  return {
    authKind: "session",
    session,
    apiKeyId: null,
    authz,
    username,
  };
}

async function getApiKeyAuthzContext(): Promise<ApiKeyAuthzContext | null> {
  const h = await headers();
  const secret = extractApiKeyFromHeaders(h);
  if (!secret) return null;

  const key = await authenticateApiKey(secret);
  if (!key) {
    throw new AuthError("UNAUTHORIZED");
  }

  const limited = apiKeyRateLimiter.check(`api-key:${key.id}`);
  if (!limited.allowed) {
    throw new AuthError("RATE_LIMITED", "API key rate limit exceeded");
  }

  return {
    authKind: "api_key",
    session: null,
    apiKeyId: key.id,
    authz: {
      userId: `api_key:${key.id}`,
      roles: [],
      permissions: key.permissions,
    },
    username: null,
  };
}

/**
 * Browser session only (pages + cookie APIs that need a real user).
 */
export async function requireAuthz(): Promise<SessionAuthzContext> {
  const ctx = await getSessionAuthzContext();
  if (!ctx) {
    throw new AuthError("UNAUTHORIZED");
  }
  return ctx;
}

export async function requirePermission(
  permission: PermissionCode,
): Promise<SessionAuthzContext> {
  const ctx = await requireAuthz();
  if (!hasPermission(ctx.authz.permissions, permission)) {
    throw new AuthError("FORBIDDEN");
  }
  return ctx;
}

/**
 * Session cookie OR API key. Used by Route Handlers via requireApiPermission.
 */
export async function requireApiAuthz(): Promise<AuthzContext> {
  const h = await headers();
  const secret = extractApiKeyFromHeaders(h);
  if (secret) {
    const apiCtx = await getApiKeyAuthzContext();
    if (!apiCtx) throw new AuthError("UNAUTHORIZED");
    return apiCtx;
  }

  return requireAuthz();
}

export async function requireApiAuthzPermission(
  permission: PermissionCode,
): Promise<AuthzContext> {
  const ctx = await requireApiAuthz();
  if (!hasPermission(ctx.authz.permissions, permission)) {
    throw new AuthError("FORBIDDEN");
  }
  return ctx;
}

/** Session user id for mutating handlers; rejects API-key actors. */
export function requireSessionUserId(ctx: AuthzContext): string {
  if (ctx.authKind !== "session") {
    throw new AuthError("FORBIDDEN", "API keys cannot perform this action");
  }
  return ctx.session.user.id;
}

export function rateLimitExceededResponse(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: "Too many requests", code: "RATE_LIMITED" },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSec) },
    },
  );
}
