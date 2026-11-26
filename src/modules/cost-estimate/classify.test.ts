import { describe, expect, it } from "vitest";
import { classifyCostEstimateType } from "@/modules/cost-estimate/classify";
import { CALL_TYPE, classifyCallGeography } from "@/modules/traffic/call-class";
import type { TariffAbcRate } from "@/modules/traffic/tariff-match";

const RATES: TariffAbcRate[] = [
  {
    direction: "г. Новосибирск",
    abc: "7383",
    digitLengths: [11],
    sortIndex: 0,
  },
  {
    direction: "Мобильные РФ",
    abc: "7903",
    digitLengths: [11],
    sortIndex: 1,
  },
];

describe("classifyCostEstimateType", () => {
  it("classifies mobile, intercity, and international from B only", () => {
    expect(classifyCostEstimateType("79031234567", RATES)).toBe(CALL_TYPE.mobile);
    expect(classifyCostEstimateType("73831234567", RATES)).toBe(
      CALL_TYPE.intercity,
    );
    expect(classifyCostEstimateType("442071234567", RATES)).toBe(
      CALL_TYPE.international,
    );
  });

  it("never returns local with an empty ANI", () => {
    expect(classifyCallGeography("", "73831234567", RATES, "outgoing")).not.toBe(
      "local",
    );
    expect(classifyCostEstimateType("73831234567", RATES)).toBe(
      CALL_TYPE.intercity,
    );
  });
});
