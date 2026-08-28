import { formatCount } from "@/lib/format-count";

export function composeVoipmonitorJobsBanner(
  unenriched: number,
  enabled: boolean,
): string | null {
  if (unenriched <= 0) return null;
  const count = formatCount(unenriched);
  const base = `Без ссылки VoIPmonitor: ${count} записей.`;
  if (!enabled) {
    return `${base} Обогащение выключено в Настройках.`;
  }
  return `${base} Идёт фоновое обогащение.`;
}
