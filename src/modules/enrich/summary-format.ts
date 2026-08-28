import { formatCount } from "@/lib/format-count";
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
    { label: "Строк", value: formatCount(summary.rows) },
    { label: "Пропущено строк", value: formatCount(summary.badLines) },
    { label: "Уникальных номеров", value: formatCount(summary.uniquePhones) },
    { label: "Уникальных IP", value: formatCount(summary.uniqueIps) },
    {
      label: "Описания",
      value: `${formatCount(summary.descriptionFound)} найдено / ${formatCount(summary.descriptionMissing)} ${asMissPhrase(MISSING_BILLING_LABEL)}`,
    },
    {
      label: "PSTN",
      value: `${formatCount(summary.pstnFound)} найдено / ${formatCount(summary.pstnMissing)} ${asMissPhrase(MISSING_PSTN_LABEL)}`,
    },
    {
      label: "GeoIP",
      value: `${formatCount(summary.geoipLookedUp)} IP`,
    },
    { label: "Файл", value: summary.outputFilename },
  ];
}
