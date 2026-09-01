export const DETAIL_SORT_GROUPS = [
  "in",
  "out",
  "parking",
  "external",
  "ldc",
] as const;

export type DetailSortGroup = (typeof DETAIL_SORT_GROUPS)[number];

export type DetailSortKey = "client" | DetailSortGroup;

export type DetailMetricRow = {
  client: string;
  inCalls: number;
  inMinutes: number;
  outCalls: number;
  outMinutes: number;
  parkingCalls: number;
  parkingMinutes: number;
  externalCalls: number;
  externalMinutes: number;
  ldcCalls: number;
  ldcMinutes: number;
};

function minutesOf(row: DetailMetricRow, key: DetailSortGroup): number {
  switch (key) {
    case "in":
      return row.inMinutes;
    case "out":
      return row.outMinutes;
    case "parking":
      return row.parkingMinutes;
    case "external":
      return row.externalMinutes;
    case "ldc":
      return row.ldcMinutes;
  }
}

export function compareClients(a: string, b: string): number {
  return a.localeCompare(b, "ru");
}

export function sortDetailRows(
  rows: readonly DetailMetricRow[],
  key: DetailSortKey,
): DetailMetricRow[] {
  const copy = rows.slice();
  if (key === "client") {
    copy.sort((a, b) => compareClients(a.client, b.client));
    return copy;
  }
  copy.sort((a, b) => {
    const diff = minutesOf(b, key) - minutesOf(a, key);
    if (diff !== 0) return diff;
    return compareClients(a.client, b.client);
  });
  return copy;
}
