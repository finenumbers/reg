import { descriptionOrMissing } from "@/modules/enrich/types";

/** Catalog «Описание» for one live-call number. Blank and unknown are «-». */
export function liveCallSide(number: string, descriptions: ReadonlyMap<string, string>): string {
  const key = number.trim();
  if (!key) return descriptionOrMissing(undefined);
  return descriptionOrMissing(descriptions.get(key));
}

/** Distinct trimmed A and B numbers. Empty numbers are not looked up. */
export function liveCallPhoneKeys(rows: readonly { outA: string; outB: string }[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    const outA = row.outA.trim();
    const outB = row.outB.trim();
    if (outA) keys.add(outA);
    if (outB) keys.add(outB);
  }
  return [...keys];
}

export function applyLiveCallSides<T extends { outA: string; outB: string; sideA: string; sideB: string }>(
  rows: readonly T[],
  descriptions: ReadonlyMap<string, string>,
): T[] {
  return rows.map((row) => ({
    ...row,
    sideA: liveCallSide(row.outA, descriptions),
    sideB: liveCallSide(row.outB, descriptions),
  }));
}
