/**
 * Traffic-table adapter and Prisma predicates for CDR row flags.
 */

import type { Prisma } from "@/generated/prisma/client";
import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";
import {
  classifyCdrRow,
  type CdrRowFlag,
} from "@/modules/enrich/row-flags";

export type TrafficRowFlags = {
  phantom?: boolean;
  callErrors?: boolean;
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
  });
}

export function trafficFlagWhere(
  flags: TrafficRowFlags,
): Prisma.CdrRecordWhereInput | null {
  const phantom = Boolean(flags.phantom);
  const callErrors = Boolean(flags.callErrors);
  if (!phantom && !callErrors) return null;

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
  if (parts.length === 1) return parts[0]!;
  return { OR: parts };
}
