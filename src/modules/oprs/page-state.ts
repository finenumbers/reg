/** Client rules for gluing one OPRS snapshot. A foreign page is dropped whole. */

export function acceptOprsPage(
  replace: boolean,
  openSnapshot: string | null,
  incomingSnapshot: string,
): boolean {
  if (replace) return true;
  return openSnapshot != null && openSnapshot === incomingSnapshot;
}

export function appendOprsItems<T extends { id: string }>(
  prev: T[],
  next: readonly T[],
): T[] {
  if (next.length === 0) return prev;
  const seen = new Set(prev.map((row) => row.id));
  const extra: T[] = [];
  for (const row of next) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    extra.push(row);
  }
  if (extra.length === 0) return prev;
  return [...prev, ...extra];
}
