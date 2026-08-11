import { prisma } from "@/lib/db";
import {
  apiKeyPrefix,
  generateApiKeySecret,
  hashApiKey,
  verifyApiKeyHash,
} from "@/modules/api-keys/crypto";
import type { PermissionCode } from "@/modules/rbac/permissions";
import { PERMISSIONS } from "@/modules/rbac/permissions";
import { auditService, AUDIT_ACTIONS } from "@/modules/audit/service";

/** Default scopes for integration keys (read-only). */
export const API_KEY_READ_PERMISSIONS: PermissionCode[] = [
  "regs:read",
  "phones:read",
];

export type ApiKeyListItem = {
  id: string;
  name: string;
  keyPrefix: string;
  enabled: boolean;
  permissions: PermissionCode[];
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

export type AuthenticatedApiKey = {
  id: string;
  name: string;
  permissions: PermissionCode[];
};

function parsePermissions(value: unknown): PermissionCode[] {
  if (!Array.isArray(value)) return [];
  const known = new Set<string>(PERMISSIONS);
  const out: PermissionCode[] = [];
  for (const item of value) {
    if (typeof item === "string" && known.has(item)) {
      out.push(item as PermissionCode);
    }
  }
  return out;
}

function toListItem(row: {
  id: string;
  name: string;
  keyPrefix: string;
  enabled: boolean;
  permissions: unknown;
  createdAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}): ApiKeyListItem {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    enabled: row.enabled,
    permissions: parsePermissions(row.permissions),
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

export async function listApiKeys(): Promise<ApiKeyListItem[]> {
  const rows = await prisma.apiKey.findMany({
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toListItem);
}

export async function createApiKey(input: {
  name: string;
  createdByUserId: string;
  ip?: string | null;
}): Promise<{ key: ApiKeyListItem; apiKey: string }> {
  const name = input.name.trim();
  if (!name || name.length > 120) {
    throw new Error("INVALID_NAME");
  }

  const secret = generateApiKeySecret();
  const keyPrefix = apiKeyPrefix(secret);
  const keyHash = hashApiKey(secret);

  const row = await prisma.apiKey.create({
    data: {
      name,
      keyPrefix,
      keyHash,
      permissions: API_KEY_READ_PERMISSIONS,
      enabled: true,
      createdByUserId: input.createdByUserId,
    },
  });

  await auditService.append({
    actorUserId: input.createdByUserId,
    action: AUDIT_ACTIONS.API_KEY_CREATE,
    entityType: "api_key",
    entityId: row.id,
    meta: { name: row.name, keyPrefix: row.keyPrefix },
    ip: input.ip,
  });

  return { key: toListItem(row), apiKey: secret };
}

export async function revokeApiKey(input: {
  id: string;
  actorUserId: string;
  ip?: string | null;
}): Promise<ApiKeyListItem | null> {
  const existing = await prisma.apiKey.findUnique({ where: { id: input.id } });
  if (!existing) return null;
  if (!existing.enabled || existing.revokedAt) {
    return toListItem(existing);
  }

  const row = await prisma.apiKey.update({
    where: { id: input.id },
    data: {
      enabled: false,
      revokedAt: new Date(),
    },
  });

  await auditService.append({
    actorUserId: input.actorUserId,
    action: AUDIT_ACTIONS.API_KEY_REVOKE,
    entityType: "api_key",
    entityId: row.id,
    meta: { name: row.name, keyPrefix: row.keyPrefix },
    ip: input.ip,
  });

  return toListItem(row);
}

/**
 * Resolve a plaintext secret to an active API key. Updates lastUsedAt best-effort.
 */
export async function authenticateApiKey(
  secret: string,
): Promise<AuthenticatedApiKey | null> {
  if (!secret.startsWith("reg_") || secret.length < 16) return null;

  const prefix = apiKeyPrefix(secret);
  const row = await prisma.apiKey.findUnique({ where: { keyPrefix: prefix } });
  if (!row || !row.enabled || row.revokedAt) return null;
  if (!verifyApiKeyHash(secret, row.keyHash)) return null;

  const permissions = parsePermissions(row.permissions);
  if (permissions.length === 0) return null;

  // Fire-and-forget last-used stamp; do not block the request on failure.
  void prisma.apiKey
    .update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => undefined);

  return { id: row.id, name: row.name, permissions };
}
