import { describe, expect, it } from "vitest";
import {
  chargeToExcelNumber,
  chargeToKopecks,
  formatCostEstimateTotal,
  sumChargeKopecks,
} from "@/modules/cost-estimate/total-format";

describe("cost-estimate total format", () => {
  it("parses rater charges to kopecks and skips empties and local dash", () => {
    expect(chargeToKopecks("")).toBeNull();
    expect(chargeToKopecks("-")).toBeNull();
    expect(chargeToKopecks("3.00")).toBe(BigInt(300));
    expect(chargeToKopecks("0.00")).toBe(BigInt(0));
    expect(sumChargeKopecks(["1000.00", "", "-", "9000.33", "0.00"])).toBe(
      BigInt(1000033),
    );
  });

  it("formats the footer like 10 000,33", () => {
    expect(formatCostEstimateTotal(BigInt(1000033))).toBe("10 000,33");
    expect(formatCostEstimateTotal(BigInt(1033))).toBe("10,33");
    expect(formatCostEstimateTotal(BigInt(0))).toBe("0,00");
  });

  it("converts charge text to an Excel number", () => {
    expect(chargeToExcelNumber("1.50")).toBe(1.5);
    expect(chargeToExcelNumber("")).toBeNull();
    expect(chargeToExcelNumber("-")).toBeNull();
  });
});
