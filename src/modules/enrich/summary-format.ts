import {
  MISSING_BILLING_LABEL,
  MISSING_PSTN_LABEL,
  type EnrichSummary,
} from "@/modules/enrich/types";

export function asMissPhrase(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

export function formatEnrichSummary(
  summary: EnrichSummary,
): { label: string; value: string }[] {
  return [
    { label: "Строк", value: String(summary.rows) },
    { label: "Пропущено строк", value: String(summary.badLines) },
    { label: "Уникальных номеров", value: String(summary.uniquePhones) },
    { label: "Уникальных IP", value: String(summary.uniqueIps) },
    {
      label: "Описания",
      value: `${summary.descriptionFound} найдено / ${summary.descriptionMissing} ${asMissPhrase(MISSING_BILLING_LABEL)}`,
    },
    {
      label: "PSTN",
      value: `${summary.pstnFound} найдено / ${summary.pstnMissing} ${asMissPhrase(MISSING_PSTN_LABEL)}`,
    },
    {
      label: "GeoIP",
      value: `${summary.geoipLookedUp} IP`,
    },
    { label: "Файл", value: summary.outputFilename },
  ];
}
