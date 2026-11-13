import { describe, expect, it } from "vitest";
import { sipoutDidDigits } from "@/modules/sipout/did";

describe("sipout did", () => {
  it("keeps an 11-digit Russian number and a leading plus", () => {
    expect(sipoutDidDigits("74953084480")).toBe("74953084480");
    expect(sipoutDidDigits("+74953084480")).toBe("74953084480");
    expect(sipoutDidDigits("  74953084480  ")).toBe("74953084480");
  });

  it("does not invent a digit for a short 7-number", () => {
    expect(sipoutDidDigits("7123456790")).toBeNull();
    expect(sipoutDidDigits("")).toBeNull();
    expect(sipoutDidDigits("7495-308-4480")).toBeNull();
  });
});
