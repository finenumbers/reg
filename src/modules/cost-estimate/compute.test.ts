import { describe, expect, it } from "vitest";
import { buildCostEstimateRows } from "@/modules/cost-estimate/compute";
import {
  COST_ESTIMATE_EMPTY_NETWORK,
  COST_ESTIMATE_LOCAL_CHARGE,
} from "@/modules/cost-estimate/types";
import { MISSING_PSTN_LABEL } from "@/modules/enrich/types";
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
    region: null,
  },
  {
    direction: "г. Новосибирск",
    abc: "7383",
    digitLengths: [11],
    price: "1.5",
    sortIndex: 1,
    region: "Московская область, Город Москва",
  },
];

describe("buildCostEstimateRows", () => {
  it("applies the three-second grace and charges from the fourth second", () => {
    const base = {
      rates: RATES,
      pstn: new Map([
        [
          "79031234567",
          {
            operator: "ПАО МТС",
            geography: "Московская область, Город Москва",
          },
        ],
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
      region: "Московская область",
      seconds: 3,
      minutes: 0,
      price: "3",
      charge: "0.00",
      network: "МТС",
      fillTone: "red",
      operator: "ПАО МТС",
      geography: "Московская область, Город Москва",
      registryMissing: false,
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
      price: "3",
      charge: "3.00",
      registryMissing: false,
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
      region: "Московская область",
      price: "1.5",
      charge: COST_ESTIMATE_LOCAL_CHARGE,
      network: COST_ESTIMATE_EMPTY_NETWORK,
      fillTone: null,
      minutes: 1,
      registryMissing: false,
    });
  });

  it("writes - in Сеть ОПРС for non-mobile rows", () => {
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
      network: COST_ESTIMATE_EMPTY_NETWORK,
      fillTone: null,
      operator: "Ростелеком",
      geography: "НСК",
      region: "Московская область",
      price: "1.5",
      charge: "1.50",
      registryMissing: false,
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
    expect(rows[0]?.registryMissing).toBe(false);
  });

  it("marks domestic rows without an operator as registry missing and clears charge", () => {
    const mobile = buildCostEstimateRows({
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
      pstn: new Map([["79031234567", { operator: "", geography: "" }]]),
      toneMap: {},
      labelUnpainted: true,
    });
    expect(mobile[0]).toMatchObject({
      callType: CALL_TYPE.mobile,
      price: "3",
      charge: "",
      network: "",
      fillTone: null,
      operator: MISSING_PSTN_LABEL,
      geography: MISSING_PSTN_LABEL,
      registryMissing: true,
      direction: "Мобильные РФ",
      region: "",
      minutes: 1,
    });

    const intercity = buildCostEstimateRows({
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
      pstn: new Map(),
      toneMap: {},
      labelUnpainted: true,
    });
    expect(intercity[0]).toMatchObject({
      callType: CALL_TYPE.intercity,
      price: "1.5",
      charge: "",
      network: "",
      operator: MISSING_PSTN_LABEL,
      geography: MISSING_PSTN_LABEL,
      region: "Московская область",
      registryMissing: true,
    });

    const local = buildCostEstimateRows({
      rows: [
        {
          rowNumber: 2,
          dateDisplay: "d",
          aNumberRaw: "73831234567",
          aDigits: "73831234567",
          bNumberRaw: "73839999999",
          bDigits: "73839999999",
          seconds: 60,
        },
      ],
      rates: RATES,
      pstn: new Map([
        ["73839999999", { operator: MISSING_PSTN_LABEL, geography: "X" }],
      ]),
      toneMap: {},
      labelUnpainted: true,
    });
    expect(local[0]).toMatchObject({
      callType: CALL_TYPE.local,
      price: "1.5",
      charge: COST_ESTIMATE_LOCAL_CHARGE,
      network: "",
      operator: MISSING_PSTN_LABEL,
      geography: MISSING_PSTN_LABEL,
      region: "Московская область",
      registryMissing: true,
    });
  });

  it("does not mark international rows without an operator", () => {
    const rows = buildCostEstimateRows({
      rows: [
        {
          rowNumber: 2,
          dateDisplay: "d",
          aNumberRaw: "",
          aDigits: "",
          bNumberRaw: "442071234567",
          bDigits: "442071234567",
          seconds: 60,
        },
      ],
      rates: RATES,
      pstn: new Map(),
      toneMap: {},
      labelUnpainted: true,
    });
    expect(rows[0]).toMatchObject({
      callType: CALL_TYPE.international,
      registryMissing: false,
      operator: "",
      geography: "",
      network: COST_ESTIMATE_EMPTY_NETWORK,
      price: "",
    });
    expect(rows[0]?.charge).not.toBeUndefined();
  });

  it("keeps geography empty when the operator is present", () => {
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
        ["73831234567", { operator: "Ростелеком", geography: "" }],
      ]),
      toneMap: {},
      labelUnpainted: true,
    });
    expect(rows[0]).toMatchObject({
      registryMissing: false,
      operator: "Ростелеком",
      geography: "",
      network: COST_ESTIMATE_EMPTY_NETWORK,
      price: "1.5",
      charge: "1.50",
    });
  });
});
