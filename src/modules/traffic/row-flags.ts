/**
 * Traffic-table adapter and Prisma predicates for CDR row flags.
 */

import type { Prisma } from "@/generated/prisma/client";
import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";
import {
  classifyCdrRow,
  PARKING_DIAL_OBJECT,
  type CdrRowFlag,
} from "@/modules/enrich/row-flags";

export type TrafficRowFlags = {
  phantom?: boolean;
  callErrors?: boolean;
  parking?: boolean;
};

export function parseTrafficFlagParam(raw: string | null): boolean {
  return raw === "1" || raw === "true";
}

export function classifyTrafficListRow(
  data: Record<string, string>,
): CdrRowFlag {
  return classifyCdrRow({
    aNumber: data.bill_ani ?? "",
    bNumber: data.bill_dnis ?? "",
    sideA: data.side_a ?? "",
    sideB: data.side_b ?? "",
    dialObject: data.dp_name ?? "",
  });
}

function knownSideWhere(
  field: "sideA" | "sideB",
): Prisma.CdrRecordWhereInput {
  return {
    AND: [{ [field]: { not: "" } }, { [field]: { not: MISSING_BILLING_LABEL } }],
  };
}

/** Same rows as classifyCdrRow → parking_known. */
export function parkingKnownWhere(): Prisma.CdrRecordWhereInput {
  return {
    AND: [
      { dpName: PARKING_DIAL_OBJECT },
      { OR: [{ billAni: { not: "" } }, { billDnis: { not: "" } }] },
      { OR: [knownSideWhere("sideA"), knownSideWhere("sideB")] },
    ],
  };
}

export function trafficFlagWhere(
  flags: TrafficRowFlags,
): Prisma.CdrRecordWhereInput | null {
  const phantom = Boolean(flags.phantom);
  const callErrors = Boolean(flags.callErrors);
  const parking = Boolean(flags.parking);
  if (!phantom && !callErrors && !parking) return null;

  const parts: Prisma.CdrRecordWhereInput[] = [];
  if (phantom) {
    parts.push({
      billAni: { not: "" },
      billDnis: { not: "" },
      sideA: MISSING_BILLING_LABEL,
      sideB: MISSING_BILLING_LABEL,
    });
  }
  if (callErrors) {
    parts.push({
      billAni: "",
      billDnis: "",
    });
  }
  if (parking) {
    parts.push(parkingKnownWhere());
  }
  if (parts.length === 1) return parts[0]!;
  return { OR: parts };
}
