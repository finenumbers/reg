/**
 * Routing groups catalog — the latest RTU snapshot.
 */

import { prisma } from "@/lib/db";
import { sortRoutingGroupsById } from "@/modules/groups/sort";

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
