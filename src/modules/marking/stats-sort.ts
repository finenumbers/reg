/**
 * Client order, or one network column descending with the client as the tie break.
 * «Итого» and «Количество номеров» are not sort keys.
 */

import { compareClients } from "@/modules/detail/sort";

export const MARKING_STATS_NETWORK_SORTS = [
  "mts",
  "megafon",
  "beeline",
  "t2",
  "external",
] as const;

export type MarkingStatsNetworkSort = (typeof MARKING_STATS_NETWORK_SORTS)[number];

export type MarkingStatsRow = {
  client: string;
  numbers: number;
  mts: number;
  megafon: number;
  beeline: number;
  t2: number;
  external: number;
  total: number;
};

export function sortMarkingStatsRows(
  rows: readonly MarkingStatsRow[],
  key: MarkingStatsNetworkSort | null,
): MarkingStatsRow[] {
  const copy = rows.slice();
  if (key == null) {
    copy.sort((a, b) => compareClients(a.client, b.client));
    return copy;
  }
  copy.sort((a, b) => {
    const diff = b[key] - a[key];
    if (diff !== 0) return diff;
    return compareClients(a.client, b.client);
  });
  return copy;
}
