/**
 * Idempotent platform baseline data (RBAC, allowlist action, app_settings).
 * Safe to run on every startup and via `npm run db:seed`.
 */

import { prisma } from "@/lib/db";

const PERMISSIONS = [
  { code: "settings:write", description: "Update settings and SSH profile" },
  { code: "ssh:test", description: "Run SSH connection test" },
  { code: "regs:read", description: "View registrations" },
  { code: "regs:poll", description: "Trigger manual registration poll" },
  { code: "phones:read", description: "View phone endpoints and gateways" },
  {
    code: "phones:request",
    description: "Trigger phones.sync from softswitch",
  },
  { code: "audit:read", description: "View audit log" },
  { code: "users:admin", description: "Manage users and roles" },
] as const;

/**
 * Ensures roles, permissions, allowlist rows, and app_settings singleton.
 * Does not create users — that remains admin bootstrap from env.
 */
export async function ensurePlatformBaseline(): Promise<{ ok: true }> {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      create: { ...p },
      update: { description: p.description },
    });
  }

  const admin = await prisma.role.upsert({
    where: { name: "admin" },
    create: { name: "admin", description: "Full configuration access" },
    update: {},
  });

  const operator = await prisma.role.upsert({
    where: { name: "operator" },
    create: {
      name: "operator",
      description: "Read regs/phones + manual sync/poll",
    },
    update: {},
  });

  const allPerms = await prisma.permission.findMany();
  for (const perm of allPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: admin.id, permissionId: perm.id },
      },
      create: { roleId: admin.id, permissionId: perm.id },
      update: {},
    });
  }

  const operatorCodes = new Set([
    "regs:read",
    "regs:poll",
    "phones:read",
    "phones:request",
    "ssh:test",
  ]);
  for (const perm of allPerms.filter((p) => operatorCodes.has(p.code))) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: operator.id, permissionId: perm.id },
      },
      create: { roleId: operator.id, permissionId: perm.id },
      update: {},
    });
  }

  await prisma.allowedAction.upsert({
    where: { code: "regs.poll" },
    create: {
      code: "regs.poll",
      remotePath: "/opt/scripts/check_regs.sh",
      description: "Poll SIP registrations",
      enabled: true,
      module: "registrations",
    },
    update: {
      remotePath: "/opt/scripts/check_regs.sh",
      enabled: true,
      module: "registrations",
    },
  });

  await prisma.allowedAction.upsert({
    where: { code: "phones.sync" },
    create: {
      code: "phones.sync",
      remotePath: "/opt/scripts/export.py",
      description: "Sync phone endpoints/gateways (read-only JSON)",
      enabled: true,
      module: "phones",
    },
    update: {
      remotePath: "/opt/scripts/export.py",
      enabled: true,
      module: "phones",
    },
  });

  await prisma.allowedAction.upsert({
    where: { code: "groups.sync" },
    create: {
      code: "groups.sync",
      remotePath: "/opt/scripts/export.py",
      description: "Sync routing groups catalog (read-only JSON)",
      enabled: true,
      module: "groups",
    },
    update: {
      remotePath: "/opt/scripts/export.py",
      enabled: true,
      module: "groups",
    },
  });

  await prisma.allowedAction.upsert({
    where: { code: "cdr.import" },
    create: {
      code: "cdr.import",
      remotePath: "/opt/scripts/cdr_import",
      description: "Import softswitch CDR files from the local FTP inbox",
      enabled: true,
      module: "traffic",
    },
    update: {
      remotePath: "/opt/scripts/cdr_import",
      enabled: true,
      module: "traffic",
    },
  });

  await prisma.allowedAction.upsert({
    where: { code: "voipmonitor.match" },
    create: {
      code: "voipmonitor.match",
      remotePath: "/opt/scripts/voipmonitor_match",
      description: "Correlate CDR rows with VoIPmonitor",
      enabled: true,
      module: "traffic",
    },
    update: {
      remotePath: "/opt/scripts/voipmonitor_match",
      enabled: true,
      module: "traffic",
    },
  });

  await prisma.allowedAction.upsert({
    where: { code: "cdr.sides.refresh" },
    create: {
      code: "cdr.sides.refresh",
      remotePath: "/opt/scripts/cdr_sides_refresh",
      description: "Refresh CDR side labels from the phones catalog",
      enabled: true,
      module: "traffic",
    },
    update: {
      remotePath: "/opt/scripts/cdr_sides_refresh",
      enabled: true,
      module: "traffic",
    },
  });

  await prisma.allowedAction.upsert({
    where: { code: "cdr.purge.month" },
    create: {
      code: "cdr.purge.month",
      remotePath: "/opt/scripts/cdr_purge_month",
      description: "Delete the oldest complete CDR calendar month",
      enabled: true,
      module: "traffic",
    },
    update: {
      remotePath: "/opt/scripts/cdr_purge_month",
      enabled: true,
      module: "traffic",
    },
  });

  await prisma.appSetting.upsert({
    where: { id: 1 },
    create: { id: 1, artifactMaxBytes: 50_000_000 },
    update: {},
  });

  // Bump legacy 1 MiB default so full softswitch dumps fit in job artifacts.
  await prisma.appSetting.updateMany({
    where: { id: 1, artifactMaxBytes: 1_048_576 },
    data: { artifactMaxBytes: 50_000_000 },
  });

  await prisma.phoneImportState.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });

  await prisma.routingGroupImportState.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });

  return { ok: true };
}
