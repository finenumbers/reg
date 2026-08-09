/**
 * RBAC permission codes (seeded via prisma/seed.ts).
 */

export const PERMISSIONS = [
  "settings:write",
  "ssh:test",
  "regs:read",
  "regs:poll",
  "phones:read",
  "phones:request",
  "audit:read",
  "users:admin",
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number];

export const ROLES = ["admin", "operator"] as const;
export type RoleName = (typeof ROLES)[number];

export const ROLE_PERMISSIONS: Record<RoleName, PermissionCode[]> = {
  admin: [
    "settings:write",
    "ssh:test",
    "regs:read",
    "regs:poll",
    "phones:read",
    "phones:request",
    "audit:read",
    "users:admin",
  ],
  operator: [
    "regs:read",
    "regs:poll",
    "phones:read",
    "phones:request",
    "ssh:test",
  ],
};

export function hasPermission(
  granted: readonly string[] | undefined,
  required: PermissionCode,
): boolean {
  return Boolean(granted?.includes(required));
}
