export type StateLabelPair = {
  key: string;
  value: string;
};

/**
 * One interface string per stored key.
 * An empty key, an empty interface string, or a repeated key stays unmapped,
 * so the cell keeps the value `selectRowset` returned.
 */
export function stateLabelMap(pairs: readonly StateLabelPair[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const pair of pairs) {
    counts.set(pair.key, (counts.get(pair.key) ?? 0) + 1);
  }
  const labels = new Map<string, string>();
  for (const pair of pairs) {
    if (pair.key === "" || pair.value === "") continue;
    if (counts.get(pair.key) !== 1) continue;
    labels.set(pair.key, pair.value);
  }
  return labels;
}

/** Exact key match. A blank cell and an unknown key stay as returned. */
export function presentCallState(
  raw: string,
  labels: ReadonlyMap<string, string> | null,
): string {
  if (!labels || raw === "") return raw;
  return labels.get(raw) ?? raw;
}
