import { headers } from "next/headers";
import { auth } from "@/modules/auth/auth";
import { AuthError } from "@/modules/auth/errors";
import {
  getUserAuthz,
  type UserAuthz,
} from "@/modules/rbac/service";
import { hasPermission, type PermissionCode } from "@/modules/rbac/permissions";
import { prisma } from "@/lib/db";

export type AuthSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>;

export type AuthzContext = {
  session: AuthSession;
  authz: UserAuthz;
  username: string | null;
};

export async function getSession(): Promise<AuthSession | null> {
  return auth.api.getSession({
    headers: await headers(),
  });
}

/**
 * Session + RBAC + active-user check. Returns null when anonymous.
 * Throws AuthError("INACTIVE") when the account is disabled.
 */
export async function getAuthzContext(): Promise<AuthzContext | null> {
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

  return { session, authz, username };
}

export async function requireAuthz(): Promise<AuthzContext> {
  const ctx = await getAuthzContext();
  if (!ctx) {
    throw new AuthError("UNAUTHORIZED");
  }
  return ctx;
}

export async function requirePermission(
  permission: PermissionCode,
): Promise<AuthzContext> {
  const ctx = await requireAuthz();
  if (!hasPermission(ctx.authz.permissions, permission)) {
    throw new AuthError("FORBIDDEN");
  }
  return ctx;
}
