/**
 * Admin bootstrap from env (ADMIN_USERNAME / ADMIN_PASSWORD [/ ADMIN_DISPLAY_NAME]).
 *
 * Behavior:
 * - Creates the bootstrap admin when that username does not exist and the users
 *   table is empty (first-run).
 * - If the username already exists: does not change the password; ensures the
 *   `admin` role binding; returns `exists`.
 * - If other users already exist and the bootstrap username is missing: skips
 *   (does not invent a second privileged account on an established system).
 * - Never logs passwords or other secrets.
 *
 * Password hashing uses Better Auth's `hashPassword` so credential accounts
 * remain compatible with the username plugin sign-in path.
 */

import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { assignRoleToUser } from "@/modules/rbac/service";

export type BootstrapAdminResult =
  | { status: "skipped"; reason: string }
  | { status: "created"; username: string; userId: string }
  | { status: "exists"; username: string; userId: string; roleEnsured: boolean };

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function bootstrapEmail(username: string): string {
  // Synthetic local-only email — Better Auth requires a unique email field.
  // Primary login identifier remains username.
  return `${username}@local.reg`;
}

function readBootstrapEnv(): {
  username: string;
  password: string;
  displayName: string;
} | null {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return null;
  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters");
  }
  const displayName =
    process.env.ADMIN_DISPLAY_NAME?.trim() || username;
  return { username, password, displayName };
}

async function ensureAdminRole(
  userId: string,
  username: string,
): Promise<boolean> {
  const { created } = await assignRoleToUser(userId, "admin");
  if (created) {
    await auditService.append({
      actorUserId: userId,
      action: AUDIT_ACTIONS.ROLE_ASSIGN,
      entityType: "user",
      entityId: userId,
      meta: { role: "admin", username, source: "admin_bootstrap" },
    });
  }
  return created;
}

export async function bootstrapAdminIfEmpty(): Promise<BootstrapAdminResult> {
  const env = readBootstrapEnv();
  if (!env) {
    return {
      status: "skipped",
      reason: "ADMIN_USERNAME / ADMIN_PASSWORD not set",
    };
  }

  const username = normalizeUsername(env.username);
  if (username.length < 3) {
    throw new Error("ADMIN_USERNAME must be at least 3 characters");
  }

  const existing = await prisma.user.findUnique({
    where: { username },
  });

  if (existing) {
    const roleEnsured = await ensureAdminRole(existing.id, username);
    logger.info("admin.bootstrap.exists", {
      username,
      roleEnsured,
    });
    return {
      status: "exists",
      username,
      userId: existing.id,
      roleEnsured,
    };
  }

  const userCount = await prisma.user.count();
  if (userCount > 0) {
    return {
      status: "skipped",
      reason:
        "Users already exist and bootstrap username was not found; refusing to create an additional admin",
    };
  }

  const userId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const passwordHash = await hashPassword(env.password);
  const email = bootstrapEmail(username);

  await prisma.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: userId,
        name: env.displayName,
        email,
        emailVerified: true,
        username,
        displayUsername: env.displayName,
        isActive: true,
      },
    });

    await tx.account.create({
      data: {
        id: accountId,
        accountId: userId,
        providerId: "credential",
        userId,
        password: passwordHash,
      },
    });
  });

  await ensureAdminRole(userId, username);

  await auditService.append({
    actorUserId: userId,
    action: AUDIT_ACTIONS.ADMIN_BOOTSTRAP,
    entityType: "user",
    entityId: userId,
    meta: { username, source: "env" },
  });

  logger.info("admin.bootstrap.created", { username });

  return { status: "created", username, userId };
}
