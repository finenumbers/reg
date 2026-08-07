import { prisma } from "@/lib/db";
import {
  type PermissionCode,
  type RoleName,
  PERMISSIONS,
} from "@/modules/rbac/permissions";

export type UserAuthz = {
  userId: string;
  roles: RoleName[];
  permissions: PermissionCode[];
};

/**
 * Resolve roles + permission codes for a Better Auth user id.
 */
export async function getUserAuthz(userId: string): Promise<UserAuthz> {
  const userRoles = await prisma.userRole.findMany({
    where: { userId },
    include: {
      role: {
        include: {
          permissions: {
            include: { permission: true },
          },
        },
      },
    },
  });

  const roleNames = new Set<RoleName>();
  const permissionCodes = new Set<PermissionCode>();
  const knownPermissions = new Set<string>(PERMISSIONS);

  for (const ur of userRoles) {
    if (ur.role.name === "admin" || ur.role.name === "operator") {
      roleNames.add(ur.role.name);
    }
    for (const rp of ur.role.permissions) {
      const code = rp.permission.code;
      if (knownPermissions.has(code)) {
        permissionCodes.add(code as PermissionCode);
      }
    }
  }

  return {
    userId,
    roles: [...roleNames],
    permissions: [...permissionCodes],
  };
}

/**
 * Bind a user to a seeded role by name. Idempotent.
 * Returns whether a new binding was created.
 */
export async function assignRoleToUser(
  userId: string,
  roleName: RoleName,
): Promise<{ created: boolean; roleId: string }> {
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    throw new Error(`Role "${roleName}" is not seeded`);
  }

  const existing = await prisma.userRole.findUnique({
    where: {
      userId_roleId: { userId, roleId: role.id },
    },
  });

  if (existing) {
    return { created: false, roleId: role.id };
  }

  await prisma.userRole.create({
    data: { userId, roleId: role.id },
  });

  return { created: true, roleId: role.id };
}
