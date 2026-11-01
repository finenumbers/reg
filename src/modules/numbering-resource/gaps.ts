/**
 * One visible separator per full-data ABC gap.
 * Prefer gapAfter on the upper row so the same hole is not drawn twice.
 * Flags stay the full-dataset values from PSTN. Do not recompute them
 * from the rows on screen.
 */

export function effectiveAbcRangeGapMarkers(
  row: { abcRangeGapBefore: boolean; abcRangeGapAfter: boolean },
  prev?: { abcRangeGapAfter: boolean } | null,
): { gapBefore: boolean; gapAfter: boolean } {
  return {
    gapBefore: row.abcRangeGapBefore && !prev?.abcRangeGapAfter,
    gapAfter: row.abcRangeGapAfter,
  };
}

/** One shadow declaration. Two Tailwind shadow classes overwrite each other. */
export function numberingGapShadowClass(
  gapBefore: boolean,
  gapAfter: boolean,
): string | undefined {
  if (gapBefore && gapAfter) {
    return "shadow-[inset_0_2px_0_0_var(--color-destructive),inset_0_-2px_0_0_var(--color-destructive)]";
  }
  if (gapBefore) return "shadow-[inset_0_2px_0_0_var(--color-destructive)]";
  if (gapAfter) return "shadow-[inset_0_-2px_0_0_var(--color-destructive)]";
  return undefined;
}
