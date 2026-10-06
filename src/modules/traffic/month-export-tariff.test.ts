import { describe, expect, it } from "vitest";
import { patchTouchesSide } from "@/modules/traffic/month-export-gaps";
import { withStoredTariff } from "@/modules/traffic/month-export-pipeline";

const stored = {
  tariffDirection: "Россия",
  tariffPrice: "1.50",
  tariffCharge: "3.00",
  tariffCost: "1.20",
  tariffProfit: "1.80",
};

describe("month export tariff after a side fill", () => {
  it("uses the post-update money when the side changed", () => {
    const updated = {
      ...stored,
      tariffCost: "0.00",
      tariffProfit: "3.00",
    };
    expect(withStoredTariff(stored, updated)).toMatchObject({
      tariffCost: "0.00",
      tariffProfit: "3.00",
    });
  });

  it("leaves the selected tariff when the side did not change", () => {
    expect(withStoredTariff(stored, undefined)).toEqual(stored);
    expect(patchTouchesSide({ sideB: "Офис" })).toBe(true);
    expect(patchTouchesSide({ operatorA: "МТС" })).toBe(false);
  });
});
