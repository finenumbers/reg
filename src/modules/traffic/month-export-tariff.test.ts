import { describe, expect, it } from "vitest";
import { patchTouchesSide } from "@/modules/traffic/month-export-gaps";
import { withStoredTariff } from "@/modules/traffic/month-export-pipeline";

const stored = {
  tariffDirection: "Россия",
  tariffPrice: "1.50",
  tariffCharge: "3.00",
};

describe("month export tariff after a side fill", () => {
  it("uses the post-update tariff when the side changed", () => {
    const updated = {
      tariffDirection: "Москва",
      tariffPrice: "2",
      tariffCharge: "4.00",
    };
    expect(withStoredTariff(stored, updated)).toEqual(updated);
  });

  it("leaves the selected tariff when the side did not change", () => {
    expect(withStoredTariff(stored, undefined)).toEqual(stored);
    expect(patchTouchesSide({ sideB: "Офис" })).toBe(true);
    expect(patchTouchesSide({ operatorA: "МТС" })).toBe(false);
  });
});
