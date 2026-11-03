import { parseNaiveDateTime } from "@/modules/enrich/dates";
import { PARKING_DST } from "@/modules/stats/classify";
import { CALL_CATEGORY, classifyCallCategory } from "@/modules/traffic/call-class";
import type { TariffAbcRate } from "@/modules/traffic/tariff-match";
import type { LiveCallTone } from "@/modules/live-calls/row-class";

export type LiveCallToneInput = {
  sideA: string;
  sideB: string;
  destName: string;
  sourceName: string;
  dialpeer: string;
  outB: string;
  connectedAt: string;
};

/**
 * Phantom is green even before connect. Incoming and outgoing parking are
 * blue once the connection stamp parses. A catalog failure paints nothing:
 * every side would otherwise look unknown. Check, error, and other devices
 * stay unpainted. The B-number is this table's outgoing B-number.
 */
export function liveCallTone(
  row: LiveCallToneInput,
  rates: readonly TariffAbcRate[],
  exceptions: readonly string[],
  sidesReady: boolean,
): LiveCallTone | null {
  if (!sidesReady) return null;
  const category = classifyCallCategory(
    row.sideA,
    row.sideB,
    row.destName,
    row.sourceName,
    "",
    row.dialpeer,
    row.outB,
    rates,
    exceptions,
  );
  if (category === CALL_CATEGORY.phantom) return "phantom";
  if (category !== CALL_CATEGORY.incoming && category !== CALL_CATEGORY.outgoing)
    return null;
  if (row.destName !== PARKING_DST) return null;
  if (!parseNaiveDateTime(row.connectedAt)) return null;
  return "parking";
}
