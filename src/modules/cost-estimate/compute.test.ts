import { describe, expect, it } from "vitest";
import { buildCostEstimateRows } from "@/modules/cost-estimate/compute";
import { CALL_TYPE } from "@/modules/traffic/call-class";
import type { TariffRateLookup } from "@/modules/traffic/cdr-tariff";
import { OPRS_EXTERNAL_NETWORK } from "@/modules/oprs/derived";

const RATES: TariffRateLookup[] = [
  {
    direction: "Мобильные РФ",
    abc: "7903",
    digitLengths: [11],
    price: "3",
    sortIndex: 0,
  },
  {
    direction: "г. Новосибирск",
    abc: "7383",
    digitLengths: [11],
    price: "1.5",
    sortIndex: 1,
  },
];

describe("buildCostEstimateRows", () => {
  it("applies the three-second grace and charges from the fourth second", () => {
    const base = {
      rates: RATES,
      pstn: new Map([
        ["79031234567", { operator: "ПАО МТС", geography: "Москва" }],
      ]),
      toneMap: { "ПАО МТС": "red" as const },
      labelUnpainted: true,
    };

    const grace = buildCostEstimateRows({
      ...base,
      rows: [
        {
          rowNumber: 2,
          dateDisplay: "2026-01-01",
          aNumberRaw: "",
          aDigits: "",
          bNumberRaw: "+79031234567",
          bDigits: "79031234567",
          seconds: 3,
        },
      ],
    });
    expect(grace[0]).toMatchObject({
      callType: CALL_TYPE.mobile,
      direction: "Мобильные РФ",
      seconds: 3,
      minutes: 0,
      charge: "0.00",
      network: "МТС",
      fillTone: "red",
      operator: "ПАО МТС",
      geography: "Москва",
    });

    const billed = buildCostEstimateRows({
      ...base,
      rows: [
        {
          rowNumber: 2,
          dateDisplay: "2026-01-01",
          aNumberRaw: "",
          aDigits: "",
          bNumberRaw: "+79031234567",
          bDigits: "79031234567",
          seconds: 4,
        },
      ],
    });
    expect(billed[0]).toMatchObject({
      seconds: 4,
      minutes: 1,
      charge: "3.00",
    });
  });

  it("rates a local outgoing call with direction and no money", () => {
    const rows = buildCostEstimateRows({
      rows: [
        {
          rowNumber: 2,
          dateDisplay: "d",
          aNumberRaw: "+73831234567",
          aDigits: "73831234567",
          bNumberRaw: "73839999999",
          bDigits: "73839999999",
          seconds: 60,
        },
      ],
      rates: RATES,
      pstn: new Map([
        ["73839999999", { operator: "Ростелеком", geography: "НСК" }],
      ]),
      toneMap: {},
      labelUnpainted: true,
    });
    expect(rows[0]).toMatchObject({
      callType: CALL_TYPE.local,
      aNumberRaw: "+73831234567",
      direction: "г. Новосибирск",
      charge: "",
      network: "",
      fillTone: null,
      minutes: 1,
    });
  });

  it("leaves network and fill empty for non-mobile rows", () => {
    const rows = buildCostEstimateRows({
      rows: [
        {
          rowNumber: 2,
          dateDisplay: "d",
          aNumberRaw: "",
          aDigits: "",
          bNumberRaw: "73831234567",
          bDigits: "73831234567",
          seconds: 60,
        },
      ],
      rates: RATES,
      pstn: new Map([
        ["73831234567", { operator: "Ростелеком", geography: "НСК" }],
      ]),
      toneMap: { "Ростелеком": "gray" },
      labelUnpainted: true,
    });
    expect(rows[0]).toMatchObject({
      callType: CALL_TYPE.intercity,
      seconds: 60,
      minutes: 1,
      network: "",
      fillTone: null,
      operator: "Ростелеком",
      geography: "НСК",
      charge: "1.50",
    });
  });

  it("writes Внешние сети without a fill tone when the operator is unpainted", () => {
    const rows = buildCostEstimateRows({
      rows: [
        {
          rowNumber: 2,
          dateDisplay: "d",
          aNumberRaw: "",
          aDigits: "",
          bNumberRaw: "79031234567",
          bDigits: "79031234567",
          seconds: 10,
        },
      ],
      rates: RATES,
      pstn: new Map([
        ["79031234567", { operator: "Чужой оператор", geography: "X" }],
      ]),
      toneMap: { "ПАО МТС": "red" },
      labelUnpainted: true,
    });
    expect(rows[0]?.network).toBe(OPRS_EXTERNAL_NETWORK);
    expect(rows[0]?.fillTone).toBeNull();
  });
});
