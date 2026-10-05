/**
 * Prisma predicates for CDR toolbar checkboxes.
 * Flags match stored category and status only.
 */

import type { Prisma } from "@/generated/prisma/client";
import { CALL_CATEGORY, CALL_STATUS } from "@/modules/traffic/call-class";

export type TrafficRowFlags = {
  phantom?: boolean;
  callErrors?: boolean;
  parking?: boolean;
  failed?: boolean;
  check?: boolean;
};

export function parseTrafficFlagParam(raw: string | null): boolean {
  return raw === "1" || raw === "true";
}

export function trafficFlagWhere(
  flags: TrafficRowFlags,
): Prisma.CdrRecordWhereInput | null {
  const parts: Prisma.CdrRecordWhereInput[] = [];
  if (flags.phantom) parts.push({ callCategory: CALL_CATEGORY.phantom });
  if (flags.callErrors) {
    parts.push({
      callCategory: {
        in: [CALL_CATEGORY.routeError, CALL_CATEGORY.unregistered],
      },
    });
  }
  if (flags.parking) {
    parts.push({
      callCategory: {
        in: [CALL_CATEGORY.incomingParking, CALL_CATEGORY.outgoingParking],
      },
    });
  }
  if (flags.failed) parts.push({ callStatus: CALL_STATUS.failed });
  if (flags.check) parts.push({ callCategory: CALL_CATEGORY.check });
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!;
  return { OR: parts };
}
