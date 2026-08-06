/**
 * Audit log query service — list security/operator events for admin UI.
 * Meta is sanitized; secrets never returned.
 */

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { sanitizeAuditMeta } from "@/modules/audit/sanitize";

export type ListAuditLogsFilters = {
  /** Case-insensitive substring on action */
  action?: string;
  /** Case-insensitive substring on actor username */
  actor?: string;
  page?: number;
  pageSize?: number;
};

export type AuditLogListItem = {
  id: string;
  createdAt: string;
  action: string;
  actorUserId: string | null;
  actorUsername: string | null;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  /** Sanitized meta safe for display (no secrets). */
  meta: Record<string, unknown> | null;
};

export type ListAuditLogsResult = {
  items: AuditLogListItem[];
  total: number;
  page: number;
  pageSize: number;
};

function metaAsRecord(meta: unknown): Record<string, unknown> | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  return sanitizeAuditMeta(meta as Record<string, unknown>) ?? null;
}

export async function listAuditLogs(
  filters: ListAuditLogsFilters = {},
): Promise<ListAuditLogsResult> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 100));

  const where: Prisma.AuditLogWhereInput = {};
  const action = filters.action?.trim();
  if (action) {
    where.action = { contains: action, mode: "insensitive" };
  }

  const actor = filters.actor?.trim();
  let actorUserIds: string[] | undefined;
  if (actor) {
    const matched = await prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: actor, mode: "insensitive" } },
          { name: { contains: actor, mode: "insensitive" } },
        ],
      },
      select: { id: true },
      take: 200,
    });
    actorUserIds = matched.map((u) => u.id);
    if (actorUserIds.length === 0) {
      return { items: [], total: 0, page, pageSize };
    }
    where.actorUserId = { in: actorUserIds };
  }

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const ids = [
    ...new Set(
      rows
        .map((r) => r.actorUserId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];

  const users =
    ids.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, username: true, name: true },
        });

  const userMap = new Map(
    users.map((u) => [u.id, u.username ?? u.name ?? null] as const),
  );

  return {
    items: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      action: row.action,
      actorUserId: row.actorUserId,
      actorUsername: row.actorUserId
        ? (userMap.get(row.actorUserId) ?? null)
        : null,
      entityType: row.entityType,
      entityId: row.entityId,
      ip: row.ip,
      meta: metaAsRecord(row.meta),
    })),
    total,
    page,
    pageSize,
  };
}
