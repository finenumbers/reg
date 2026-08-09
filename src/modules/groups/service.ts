/**
 * Routing groups catalog — list + operational status.
 */

import { prisma } from "@/lib/db";
import { getJobRunSummary } from "@/modules/jobs/query";

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

export type GroupsOperationalStatus = {
  lastJobStatus: "never" | "running" | "success" | "failed";
  lastError: string | null;
  lastFailedError: string | null;
  runningCount: number;
  groupCount: number;
  lastSyncedAt: string | null;
};

export async function listRoutingGroups(): Promise<ListRoutingGroupsResult> {
  const [items, state] = await Promise.all([
    prisma.routingGroup.findMany({
      orderBy: [{ sortOrder: "asc" }, { externalId: "asc" }],
      select: {
        id: true,
        externalId: true,
        name: true,
        sortOrder: true,
      },
    }),
    prisma.routingGroupImportState.findUnique({ where: { id: 1 } }),
  ]);

  return {
    items,
    total: items.length,
    lastSyncedAt: state?.lastSyncedAt?.toISOString() ?? null,
  };
}

export async function getGroupsOperationalStatus(): Promise<GroupsOperationalStatus> {
  const [summary, state, groupCount] = await Promise.all([
    getJobRunSummary("groups.sync"),
    prisma.routingGroupImportState.findUnique({ where: { id: 1 } }),
    prisma.routingGroup.count(),
  ]);

  const lastAny = summary.lastAny;
  let lastJobStatus: GroupsOperationalStatus["lastJobStatus"] = "never";
  if (lastAny) {
    lastJobStatus = lastAny.status;
  }

  return {
    lastJobStatus,
    lastError:
      lastAny?.status === "failed"
        ? (lastAny.errorMessage ?? "Sync failed")
        : lastAny?.status === "success"
          ? null
          : (summary.lastFailed?.errorMessage ?? null),
    lastFailedError: summary.lastFailed?.errorMessage ?? null,
    runningCount: summary.runningCount,
    groupCount: state?.groupCount ?? groupCount,
    lastSyncedAt: state?.lastSyncedAt?.toISOString() ?? null,
  };
}

/** Name → softswitch ID map for RTU import. */
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
