/**
 * A UIS page cannot pass offset 100000. A larger list is split by number prefix
 * until every leaf fits in that window. The leaf totals must sum to the parent.
 */

import { WINDOW, childFilters, type UisFilter } from "@/modules/uis/url";

export const UNSPLIT = "Список не разложен по номерам. Каталог не изменён.";
export const SUM_MISMATCH = "Сумма префиксов не сошлась. Каталог не изменён.";

export type Counted = { filter: UisFilter; total: number };

export type CountResult = { ok: true; total: number } | { ok: false; error: string };

export async function planSlices(
  total: number,
  count: (filter: UisFilter) => Promise<CountResult>,
  gate: () => Promise<string | null>,
): Promise<{ ok: true; slices: Counted[] } | { ok: false; error: string }> {
  if (!Number.isSafeInteger(total) || total < 0)
    return { ok: false, error: SUM_MISMATCH };
  return expand({ kind: "all" }, total, count, gate);
}

async function expand(
  parent: UisFilter,
  parentTotal: number,
  count: (filter: UisFilter) => Promise<CountResult>,
  gate: () => Promise<string | null>,
): Promise<{ ok: true; slices: Counted[] } | { ok: false; error: string }> {
  const blocked = await gate();
  if (blocked) return { ok: false, error: blocked };
  if (parentTotal === 0) return { ok: true, slices: [] };
  if (parentTotal <= WINDOW)
    return { ok: true, slices: [{ filter: parent, total: parentTotal }] };
  const children = childFilters(parent);
  if (!children) return { ok: false, error: UNSPLIT };
  let sum = 0;
  const slices: Counted[] = [];
  for (const child of children) {
    const waiting = await gate();
    if (waiting) return { ok: false, error: waiting };
    const counted = await count(child);
    if (!counted.ok) return counted;
    if (!Number.isSafeInteger(counted.total) || counted.total < 0) {
      return { ok: false, error: SUM_MISMATCH };
    }
    if (!Number.isSafeInteger(sum + counted.total))
      return { ok: false, error: SUM_MISMATCH };
    sum += counted.total;
    const nested = await expand(child, counted.total, count, gate);
    if (!nested.ok) return nested;
    slices.push(...nested.slices);
  }
  if (sum !== parentTotal) return { ok: false, error: SUM_MISMATCH };
  return { ok: true, slices };
}
