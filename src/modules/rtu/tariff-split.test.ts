import { describe, expect, it } from "vitest";
import { matchTariffAbc, type TariffAbcRate } from "@/modules/traffic/tariff-match";

function split(number: string, rates: readonly TariffAbcRate[]) {
  const rate = matchTariffAbc(number, rates);
  if (!rate) return { abc: "", telephone: "" };
  return { abc: rate.abc, telephone: number.slice(rate.abc.length) };
}

const RATES: TariffAbcRate[] = [
  { direction: "г. Один", abc: "73012", sortIndex: 0, digitLengths: null },
  { direction: "г. Два", abc: "7383", sortIndex: 1, digitLengths: null },
];

describe("tariff telephone split", () => {
  it("keeps the tariff ABC and the remaining digits", () => {
    expect(split("73012480882", RATES)).toEqual({ abc: "73012", telephone: "480882" });
    expect(split("73833999999", RATES)).toEqual({ abc: "7383", telephone: "3999999" });
  });

  it("lets a longer code on 7 win even when its length cell says otherwise", () => {
    const rates: TariffAbcRate[] = [
      ...RATES,
      { direction: "длиннее", abc: "73833", sortIndex: 2, digitLengths: [12] },
    ];
    expect(split("73833999999", rates)).toEqual({ abc: "73833", telephone: "999999" });
  });

  it("drops a longer foreign code whose length list misses the number", () => {
    const rates: TariffAbcRate[] = [
      { direction: "короткий", abc: "380", sortIndex: 0, digitLengths: null },
      { direction: "длинный", abc: "38044", sortIndex: 1, digitLengths: [12] },
    ];
    expect(split("3804412345", rates)).toEqual({ abc: "380", telephone: "4412345" });
  });

  it("leaves both parts empty when no tariff row matches", () => {
    expect(split("123", RATES)).toEqual({ abc: "", telephone: "" });
    expect(split("88005553535", RATES)).toEqual({ abc: "", telephone: "" });
    expect(split("7 (301) 248-08-82", RATES)).toEqual({ abc: "", telephone: "" });
  });
});
