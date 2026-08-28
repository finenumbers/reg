import { describe, expect, it } from "vitest";
import { formatEnrichSummary } from "@/modules/enrich/summary-format";
import type { EnrichSummary } from "@/modules/enrich/types";

const sample: EnrichSummary = {
  rows: 168995,
  badLines: 0,
  uniquePhones: 63188,
  uniqueIps: 12,
  descriptionFound: 415,
  descriptionMissing: 62773,
  pstnFound: 62546,
  pstnMissing: 642,
  pstnCacheHits: 62742,
  pstnLiveLookups: 0,
  geoipLookedUp: 12,
  geoipCacheHits: 12,
  geoipLiveLookups: 0,
  outputFilename: "20260801_000019-enriched.xlsx",
};

describe("formatEnrichSummary", () => {
  it("uses XLSX miss phrases and omits cache/API", () => {
    const rows = formatEnrichSummary(sample);
    expect(rows).toEqual([
      { label: "Строк", value: "168995" },
      { label: "Пропущено строк", value: "0" },
      { label: "Уникальных номеров", value: "63188" },
      { label: "Уникальных IP", value: "12" },
      {
        label: "Описания",
        value: "415 найдено / 62773 нет в биллинге",
      },
      {
        label: "PSTN",
        value: "62546 найдено / 642 нет в реестре МинЦифры",
      },
      { label: "GeoIP", value: "12 IP" },
      { label: "Файл", value: "20260801_000019-enriched.xlsx" },
    ]);
  });
});
