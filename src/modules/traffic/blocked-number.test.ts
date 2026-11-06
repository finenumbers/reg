import { describe, expect, it } from "vitest";
import { buildBlockedNumberIndex } from "@/modules/phones/blocked-numbers";
import { cdrHasBlockedNumber } from "@/modules/traffic/blocked-number";

describe("cdrHasBlockedNumber", () => {
  const index = buildBlockedNumberIndex(["73852222205"]);

  it("hits a hidden leg and ignores device users", () => {
    expect(cdrHasBlockedNumber(index, { inAni: "3852222205", billAni: "" })).toBe(true);
    expect(
      cdrHasBlockedNumber(index, {
        billAni: "74950000000",
        srcUser: "73852222205",
        dstUser: "73852222205",
        radiusUser: "73852222205",
      }),
    ).toBe(false);
    expect(cdrHasBlockedNumber(index, { outOrigDnis: "83852222205" })).toBe(true);
    expect(cdrHasBlockedNumber(index, { authDnis: "100" })).toBe(false);
  });
});
