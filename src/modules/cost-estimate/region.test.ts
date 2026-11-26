import { describe, expect, it } from "vitest";
import { shownCostEstimateRegion } from "@/modules/cost-estimate/region";
import { CALL_TYPE } from "@/modules/traffic/call-class";

describe("shownCostEstimateRegion", () => {
  it("uses collapsed PSTN geography for mobile", () => {
    expect(
      shownCostEstimateRegion({
        callType: CALL_TYPE.mobile,
        direction: "Мобильные РФ",
        tariffRegion: "ignored",
        pstnGeography: "Московская область, Город Москва",
        registryMissing: false,
      }),
    ).toBe("Московская область");
  });

  it("collapses tariff region for landline", () => {
    expect(
      shownCostEstimateRegion({
        callType: CALL_TYPE.intercity,
        direction: "г. Новосибирск",
        tariffRegion: "Ленинградская область, Город Санкт-Петербург",
        pstnGeography: "НСК",
        registryMissing: false,
      }),
    ).toBe("Ленинградская область");
  });

  it("uses tariff region only when registry is missing", () => {
    expect(
      shownCostEstimateRegion({
        callType: CALL_TYPE.mobile,
        direction: "Мобильные РФ",
        tariffRegion: "Московская область, Город Москва",
        pstnGeography: "Нет в реестре МинЦифры",
        registryMissing: true,
      }),
    ).toBe("Московская область");
  });

  it("copies direction when region is empty", () => {
    expect(
      shownCostEstimateRegion({
        callType: CALL_TYPE.mobile,
        direction: "Мобильные РФ",
        tariffRegion: "",
        pstnGeography: "",
        registryMissing: false,
      }),
    ).toBe("Мобильные РФ");
  });

  it("collapses Crimea geography for mobile", () => {
    expect(
      shownCostEstimateRegion({
        callType: CALL_TYPE.mobile,
        direction: "Мобильные РФ",
        tariffRegion: "",
        pstnGeography: "Город Севастополь, Республика Крым",
        registryMissing: false,
      }),
    ).toBe("Республика Крым");
  });
});
