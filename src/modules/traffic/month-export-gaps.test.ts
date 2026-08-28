import { describe, expect, it } from "vitest";
import { MISSING_PSTN_LABEL } from "@/modules/enrich/types";
import {
  applyPatchToRow,
  collectGapKeys,
  mergeEnrichGaps,
  type StoredEnrichRow,
} from "@/modules/traffic/month-export-gaps";

function row(over: Partial<StoredEnrichRow> = {}): StoredEnrichRow {
  return {
    billAni: "79501112233",
    billDnis: "78620000000",
    remoteSrcSigAddress: "1.2.3.4:5060",
    remoteDstSigAddress: "5.6.7.8:5060",
    sideA: "Офис А",
    operatorA: "МТС",
    geographyA: "Москва",
    sideB: "",
    operatorB: "",
    geographyB: "",
    countryA: "RU",
    cityA: "Moscow",
    providerA: "ISP",
    countryB: "",
    cityB: "",
    providerB: "",
    enrichedAt: null,
    ...over,
  };
}

describe("collectGapKeys", () => {
  it("asks only for the gapped side", () => {
    const keys = collectGapKeys(row());
    expect(keys.phones).toEqual(["78620000000"]);
    expect(keys.ips).toEqual(["5.6.7.8"]);
  });

  it("skips PSTN sentinel and completed GeoIP miss", () => {
    const keys = collectGapKeys(
      row({
        operatorB: MISSING_PSTN_LABEL,
        geographyB: MISSING_PSTN_LABEL,
        countryB: "",
        cityB: "",
        providerB: "",
        enrichedAt: new Date("2026-08-01T00:00:00.000Z"),
        sideB: "Нет в биллинге",
      }),
    );
    expect(keys.phones).toEqual([]);
    expect(keys.ips).toEqual([]);
  });

  it("does not treat IPv6 as a GeoIP gap", () => {
    const keys = collectGapKeys(
      row({
        remoteDstSigAddress: "2001:db8::1:5060",
        operatorB: "Билайн",
        geographyB: "Сочи",
        sideB: "Клиент",
      }),
    );
    expect(keys.ips).toEqual([]);
  });
});

describe("mergeEnrichGaps", () => {
  it("does not overwrite a filled A-side when only B is missing", () => {
    const { patch } = mergeEnrichGaps(row(), {
      descriptions: new Map([["78620000000", "Офис B"]]),
      pstn: new Map([
        [
          "78620000000",
          { found: true, operator: "Билайн", garTerritory: "Сочи" },
        ],
      ]),
      geo: new Map([
        [
          "5.6.7.8",
          {
            country: "Россия",
            countryIso: "RU",
            city: "Sochi",
            isp: "Bee",
            datasetDate: "",
          },
        ],
      ]),
    });
    expect(patch.operatorA).toBeUndefined();
    expect(patch.sideA).toBeUndefined();
    expect(patch.countryA).toBeUndefined();
    expect(patch.sideB).toBe("Офис B");
    expect(patch.operatorB).toBe("Билайн");
    expect(patch.geographyB).toBe("Сочи");
    expect(patch.countryB).toBe("RU");
    expect(patch.cityB).toBe("Sochi");
    expect(patch.providerB).toBe("Bee");
    expect(patch.enrichedAt).toBeInstanceOf(Date);
  });

  it("keeps filled A after applyPatchToRow", () => {
    const original = row();
    const { patch } = mergeEnrichGaps(original, {
      descriptions: new Map(),
      pstn: new Map([
        [
          "78620000000",
          { found: true, operator: "Билайн", garTerritory: "Сочи" },
        ],
      ]),
      geo: new Map(),
    });
    const merged = applyPatchToRow(original, patch);
    expect(merged.operatorA).toBe("МТС");
    expect(merged.operatorB).toBe("Билайн");
  });
});
