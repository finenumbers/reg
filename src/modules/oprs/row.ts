/**
 * Narrow CDR read for the OPRS table. Wide media columns stay out of the query.
 */

import type { Prisma } from "@/generated/prisma/client";
import { splitCdrDateParts } from "@/modules/traffic/cdr-date-parts";
import { parseVoipmonitorLegs } from "@/modules/voipmonitor/legs";
import type { VoipmonitorLegs } from "@/modules/voipmonitor/types";
import { isSafeVoipmonitorHref } from "@/modules/voipmonitor/url";

export const OPRS_LIST_SELECT = {
  id: true,
  cdrAt: true,
  cdrId: true,
  cdrDate: true,
  cdrDay: true,
  cdrTime: true,
  callCategory: true,
  callStatus: true,
  billAni: true,
  sideA: true,
  billDnis: true,
  sideB: true,
  outOrigDnis: true,
  elapsedTime: true,
  tariffCharge: true,
  operatorB: true,
  geographyB: true,
  srcName: true,
  dstName: true,
  dpName: true,
  disconnectCodeString: true,
  inAni: true,
  inDnis: true,
  outAni: true,
  outDnis: true,
  inOrigDnis: true,
  extAni: true,
  extDnis: true,
  authDnis: true,
} satisfies Prisma.CdrRecordSelect;

export type OprsListRow = Prisma.CdrRecordGetPayload<{ select: typeof OPRS_LIST_SELECT }>;

function text(value: string | null | undefined): string {
  return value ?? "";
}

function safeLeg(
  ref: { url: string; cdrId: string } | undefined,
  guiUrl: string,
): { url: string; cdrId: string } {
  if (!ref?.url || !guiUrl || !isSafeVoipmonitorHref(ref.url, guiUrl)) {
    return { url: "", cdrId: "" };
  }
  return { url: ref.url, cdrId: ref.cdrId };
}

/** Display cells plus the raw sort key (`cdr_date`, `cdr_id`) used as the cursor. */
export function oprsRowData(
  row: OprsListRow,
  link: { voipmonitorLegs: unknown } | null | undefined,
  guiUrl: string,
): Record<string, string> {
  const fallback = splitCdrDateParts(row.cdrDate);
  const legs: VoipmonitorLegs = parseVoipmonitorLegs(link?.voipmonitorLegs);
  const inn = safeLeg(legs.in, guiUrl);
  const out = safeLeg(legs.out, guiUrl);
  return {
    cdr_date: row.cdrDate,
    cdr_id: row.cdrId,
    cdr_day: row.cdrDay || fallback.day,
    cdr_time: row.cdrTime || fallback.time,
    call_category: text(row.callCategory),
    call_status: text(row.callStatus),
    bill_ani: text(row.billAni),
    side_a: text(row.sideA),
    bill_dnis: text(row.billDnis),
    side_b: text(row.sideB),
    out_orig_dnis: text(row.outOrigDnis),
    elapsed_time: text(row.elapsedTime),
    tariff_charge: text(row.tariffCharge),
    operator_b: text(row.operatorB),
    geography_b: text(row.geographyB),
    src_name: text(row.srcName),
    dst_name: text(row.dstName),
    dp_name: text(row.dpName),
    disconnect_code_string: text(row.disconnectCodeString),
    voipmonitor_url_in: inn.url,
    voipmonitor_cdr_id_in: inn.cdrId,
    voipmonitor_url_out: out.url,
    voipmonitor_cdr_id_out: out.cdrId,
  };
}
