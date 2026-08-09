/**
 * Replace routing_groups with export.py groups[] snapshot.
 */

import { prisma } from "@/lib/db";
import type { ParsedGroupsPayload } from "@/modules/groups/parse";

export type ApplyGroupsResult = {
  groupCount: number;
};

export async function applyGroupsSnapshot(
  payload: ParsedGroupsPayload,
  jobRunId: string,
  syncedAt: Date = new Date(),
): Promise<ApplyGroupsResult> {
  await prisma.$transaction(async (tx) => {
    await tx.routingGroup.deleteMany({});
    if (payload.groups.length > 0) {
      await tx.routingGroup.createMany({
        data: payload.groups.map((g, index) => ({
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
        groupCount: payload.groups.length,
        lastSyncedAt: syncedAt,
        lastJobRunId: jobRunId,
      },
      update: {
        groupCount: payload.groups.length,
        lastSyncedAt: syncedAt,
        lastJobRunId: jobRunId,
      },
    });
  });

  return { groupCount: payload.groups.length };
}
