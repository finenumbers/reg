/**
 * Sort routing group IDs ascending (numeric-aware: 2 before 10).
 */

export function compareRoutingGroupIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function sortRoutingGroupsById<T extends { externalId: string }>(
  rows: T[],
): T[] {
  return [...rows].sort((x, y) =>
    compareRoutingGroupIds(x.externalId, y.externalId),
  );
}
