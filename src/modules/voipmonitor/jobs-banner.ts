import { formatCount } from "@/lib/format-count";

export type JobsEnrichBannerInput = {
  voipmonitorUnenriched: number;
  voipmonitorEnabled: boolean;
  voipmonitorHasWork?: boolean;
  cdrEnrichUnenriched: number;
};

/** Open (not parked) VoIPmonitor rows belong on the yellow banner. */
export function voipmonitorBannerCount(input: {
  voipmonitorUnenriched: number;
  voipmonitorEnabled: boolean;
  voipmonitorHasWork?: boolean;
}): number {
  const open = Math.max(0, input.voipmonitorUnenriched);
  if (open <= 0) return 0;
  if (input.voipmonitorHasWork) return open;
  if (!input.voipmonitorEnabled) return open;
  return 0;
}

/** Operator-facing CDR enrich backlog on the Jobs page. */
export function composeVoipmonitorJobsBanner(
  input: JobsEnrichBannerInput,
): string | null {
  const vm = voipmonitorBannerCount(input);
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

export const VOIPMONITOR_PARKED_HINT_TITLE =
  "После 12 попыток джоба больше не ищет эти звонки.";

export function composeVoipmonitorParkedHint(parked: number): string | null {
  if (parked <= 0) return null;
  return `Не найдены в VoIPmonitor: ${formatCount(parked)}`;
}
