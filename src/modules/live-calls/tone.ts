import { parseNaiveDateTime } from "@/modules/enrich/dates";
import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";
import { PARKING_DST } from "@/modules/stats/classify";
import {
  CALL_CATEGORY,
  callCategoryReadsTariffLength,
  classifyCallCategory,
} from "@/modules/traffic/call-class";
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
 * The same five labels as «Телефонный трафик».
 * A catalog failure is «-»: both sides would otherwise look unknown.
 * Until a tariff list has loaded, a row that still needs the length check
 * is «-» as well. `*` and `#`, a malformed B-number, redirect, check,
 * phantom, and an unknown A-side do not wait. Disconnect codes are absent
 * on a live call, so those four CDR errors stay off this screen.
 * Row color stays on `liveCallTone` and does not read this text.
 */
export function liveCallCategory(
  row: LiveCallToneInput,
  rates: readonly TariffAbcRate[],
  exceptions: readonly string[],
  sidesReady: boolean,
  listsLoaded: boolean,
): string {
  if (!sidesReady) return MISSING_BILLING_LABEL;
  if (
    !listsLoaded &&
    callCategoryReadsTariffLength(
      row.sideA,
      row.sideB,
      row.destName,
      row.sourceName,
      "",
      row.dialpeer,
      row.outB,
    )
  ) {
    return MISSING_BILLING_LABEL;
  }
  return classifyCallCategory(
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
}

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
