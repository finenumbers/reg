import { describe, expect, it } from "vitest";
import {
  effectiveAbcRangeGapMarkers,
  numberingGapShadowClass,
} from "@/modules/numbering-resource/gaps";

function row(gapBefore = false, gapAfter = false) {
  return { abcRangeGapBefore: gapBefore, abcRangeGapAfter: gapAfter };
}

describe("effectiveAbcRangeGapMarkers", () => {
  it("dedupes when both neighbors mark the same gap", () => {
    const upper = row(true, true);
    const lower = row(true, false);
    expect(effectiveAbcRangeGapMarkers(upper, null)).toEqual({
      gapBefore: true,
      gapAfter: true,
    });
    expect(effectiveAbcRangeGapMarkers(lower, upper)).toEqual({
      gapBefore: false,
      gapAfter: false,
    });
  });

  it("shows gapBefore when only the lower row marks the gap", () => {
    const upper = row(true, false);
    const lower = row(true, false);
    expect(effectiveAbcRangeGapMarkers(lower, upper)).toEqual({
      gapBefore: true,
      gapAfter: false,
    });
  });

  it("shows gapAfter when the successor is hidden by a filter", () => {
    const upper = row(false, true);
    const lower = row(true, true);
    expect(effectiveAbcRangeGapMarkers(upper, null)).toEqual({
      gapBefore: false,
      gapAfter: true,
    });
    expect(effectiveAbcRangeGapMarkers(lower, upper)).toEqual({
      gapBefore: false,
      gapAfter: true,
    });
  });
});

describe("numberingGapShadowClass", () => {
  it("keeps both edges in one shadow so the top line is not overwritten", () => {
    const shadow = numberingGapShadowClass(true, true);
    expect(shadow).toContain("inset_0_2px_0_0");
    expect(shadow).toContain("inset_0_-2px_0_0");
    expect(shadow?.startsWith("shadow-[")).toBe(true);
  });

  it("returns nothing when the row has no gap", () => {
    expect(numberingGapShadowClass(false, false)).toBeUndefined();
  });
});
