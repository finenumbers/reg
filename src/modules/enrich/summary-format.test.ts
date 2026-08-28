import { describe, expect, it } from "vitest";
import { formatCount } from "@/lib/format-count";
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
      { label: "Строк", value: formatCount(168995) },
      { label: "Пропущено строк", value: formatCount(0) },
      { label: "Уникальных номеров", value: formatCount(63188) },
      { label: "Уникальных IP", value: formatCount(12) },
      {
        label: "Описания",
        value: `${formatCount(415)} найдено / ${formatCount(62773)} нет в биллинге`,
      },
      {
        label: "PSTN",
        value: `${formatCount(62546)} найдено / ${formatCount(642)} нет в реестре МинЦифры`,
      },
      { label: "GeoIP", value: `${formatCount(12)} IP` },
      { label: "Файл", value: "20260801_000019-enriched.xlsx" },
    ]);
  });
});
