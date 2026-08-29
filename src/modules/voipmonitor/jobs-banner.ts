import { formatCount } from "@/lib/format-count";

export type JobsEnrichBannerInput = {
  voipmonitorUnenriched: number;
  voipmonitorEnabled: boolean;
  voipmonitorHasWork?: boolean;
  cdrEnrichUnenriched: number;
};

/** Operator-facing CDR enrich backlog on the Jobs page. */
export function composeVoipmonitorJobsBanner(
  input: JobsEnrichBannerInput,
): string | null {
  const vm = input.voipmonitorUnenriched;
  const enrich = input.cdrEnrichUnenriched;
  if (vm <= 0 && enrich <= 0) return null;

  const parts: string[] = [];
  if (vm > 0) {
    parts.push(`Без ссылки VoIPmonitor: ${formatCount(vm)} записей.`);
  }
  if (enrich > 0) {
    const n = formatCount(enrich);
    parts.push(`Без PSTN: ${n} записей.`);
    parts.push(`Без GeoIP: ${n} записей.`);
  }
  if (vm > 0 && enrich <= 0 && !input.voipmonitorEnabled) {
    parts.push("Обогащение выключено в Настройках.");
  } else if (vm > 0 && input.voipmonitorEnabled && input.voipmonitorHasWork) {
    parts.push("Идёт фоновое обогащение.");
  }
  return parts.join(" ");
}
