/**
 * Which geography rows still need a PSTN lookup, and how a fill response
 * lands on the rows already on screen.
 */

import type { NumberGeographyItem } from "@/modules/number-geography/types";

export function blankPstnRowIds(
  items: readonly NumberGeographyItem[],
  skip: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.operator !== "" || item.geography !== "") continue;
    if (skip.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item.id);
  }
  return out;
}

export function mergePstnLabels(
  items: readonly NumberGeographyItem[],
  updates: readonly { id: string; operator: string; geography: string }[],
): NumberGeographyItem[] {
  if (updates.length === 0) return items as NumberGeographyItem[];
  const byId = new Map(updates.map((update) => [update.id, update]));
  let changed = false;
  const next = items.map((item) => {
    const update = byId.get(item.id);
    if (!update) return item;
    if (item.operator === update.operator && item.geography === update.geography) {
      return item;
    }
    changed = true;
    return { ...item, operator: update.operator, geography: update.geography };
  });
  return changed ? next : (items as NumberGeographyItem[]);
}
