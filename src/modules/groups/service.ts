/**
 * Routing groups catalog — the latest RTU snapshot.
 */

import { prisma } from "@/lib/db";
import { sortRoutingGroupsById } from "@/modules/groups/sort";
import { getJobRunSummary } from "@/modules/jobs/query";
import type { SyncSnapshot } from "@/modules/jobs/sync-line";
import { syncSnapshotFromJob } from "@/modules/jobs/sync-snapshot";

export type RoutingGroupListItem = {
  id: string;
  externalId: string;
  name: string;
  sortOrder: number;
};

export type ListRoutingGroupsResult = {
  items: RoutingGroupListItem[];
  total: number;
  lastSyncedAt: string | null;
};

export async function listRoutingGroups(): Promise<ListRoutingGroupsResult> {
  const [rows, state] = await Promise.all([
    prisma.routingGroup.findMany({
      select: {
        id: true,
        externalId: true,
        name: true,
        sortOrder: true,
      },
    }),
    prisma.routingGroupImportState.findUnique({ where: { id: 1 } }),
  ]);

  const items = sortRoutingGroupsById(rows);

  return {
    items,
    total: items.length,
    lastSyncedAt: state?.lastSyncedAt?.toISOString() ?? null,
  };
}

export type GroupsOperationalStatus = {
  lastSyncedAt: string | null;
  total: number;
  sync: SyncSnapshot;
};

/** Stamp and summary only. The open page refetches rows when the stamp moves. */
export async function getGroupsOperationalStatus(): Promise<GroupsOperationalStatus> {
  const [summary, state, total] = await Promise.all([
    getJobRunSummary("groups.sync"),
    prisma.routingGroupImportState.findUnique({ where: { id: 1 } }),
    prisma.routingGroup.count(),
  ]);
  return {
    lastSyncedAt: state?.lastSyncedAt?.toISOString() ?? null,
    total,
    sync: syncSnapshotFromJob(summary.lastSuccess),
  };
}

/** Name → RTU incoming-group ID for the RTU import CSV. */
export async function loadGroupIdByNameMap(): Promise<Map<string, string>> {
  const rows = await prisma.routingGroup.findMany({
    select: { externalId: true, name: true },
  });
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.name, row.externalId);
  }
  return map;
}
