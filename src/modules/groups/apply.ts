/**
 * Replace routing_groups with export.py groups[] snapshot.
 */

import { prisma } from "@/lib/db";
import type { ParsedGroupsPayload } from "@/modules/groups/parse";
import { sortRoutingGroupsById } from "@/modules/groups/sort";

export type ApplyGroupsResult = {
  groupCount: number;
};

const APPLY_TX = { maxWait: 10_000, timeout: 180_000 } as const;

export async function applyGroupsSnapshot(
  payload: ParsedGroupsPayload,
  jobRunId: string,
  syncedAt: Date = new Date(),
): Promise<ApplyGroupsResult> {
  const groups = sortRoutingGroupsById(payload.groups);

  await prisma.$transaction(async (tx) => {
    await tx.routingGroup.deleteMany({});
    if (groups.length > 0) {
      await tx.routingGroup.createMany({
        data: groups.map((g, index) => ({
          externalId: g.externalId,
          name: g.name,
          sortOrder: index,
          lastSyncedAt: syncedAt,
          lastJobRunId: jobRunId,
        })),
      });
    }
    await tx.routingGroupImportState.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        groupCount: groups.length,
        lastSyncedAt: syncedAt,
        lastJobRunId: jobRunId,
      },
      update: {
        groupCount: groups.length,
        lastSyncedAt: syncedAt,
        lastJobRunId: jobRunId,
      },
    });
  }, APPLY_TX);

  return { groupCount: groups.length };
}
