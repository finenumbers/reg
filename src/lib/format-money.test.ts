import { describe, expect, it } from "vitest";
import { formatMoney2 } from "@/lib/format-money";

describe("formatMoney2", () => {
  it("shows exactly two decimal places and keeps a blank cell blank", () => {
    expect(formatMoney2("")).toBe("");
    expect(formatMoney2("   ")).toBe("");
    expect(formatMoney2("0")).toBe("0.00");
    expect(formatMoney2("1.5")).toBe("1.50");
    expect(formatMoney2("10")).toBe("10.00");
    expect(formatMoney2("1.234567")).toBe("1.23");
    expect(formatMoney2("1.225")).toBe("1.23");
    expect(formatMoney2("-1.221")).toBe("-1.22");
    expect(formatMoney2("-0.004")).toBe("0.00");
    expect(formatMoney2("1234.5")).toBe("1234.50");
  });
});
