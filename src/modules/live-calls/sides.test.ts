import { describe, expect, it } from "vitest";
import { applyLiveCallSides, liveCallPhoneKeys, liveCallSide } from "@/modules/live-calls/sides";

describe("liveCallSide", () => {
  const descriptions = new Map([["100", "Офис"]]);

  it("uses the catalog description for the trimmed number", () => {
    expect(liveCallSide("100", descriptions)).toBe("Офис");
    expect(liveCallSide(" 100 ", descriptions)).toBe("Офис");
  });

  it("marks a blank or unknown number as missing", () => {
    expect(liveCallSide("", descriptions)).toBe("-");
    expect(liveCallSide("   ", descriptions)).toBe("-");
    expect(liveCallSide("999", descriptions)).toBe("-");
  });
});

describe("liveCallPhoneKeys", () => {
  it("keeps distinct non-empty numbers", () => {
    expect(
      liveCallPhoneKeys([
        { outA: " 100 ", outB: "200" },
        { outA: "100", outB: " " },
        { outA: "", outB: "" },
      ]),
    ).toEqual(["100", "200"]);
  });
});

describe("applyLiveCallSides", () => {
  it("fills both sides and leaves the numbers unchanged", () => {
    expect(
      applyLiveCallSides([{ outA: "100", outB: "", sideA: "", sideB: "" }], new Map([["100", "Офис"]])),
    ).toEqual([{ outA: "100", outB: "", sideA: "Офис", sideB: "-" }]);
  });
});
