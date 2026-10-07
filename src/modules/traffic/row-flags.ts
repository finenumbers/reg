/**
 * Prisma predicates for CDR toolbar checkboxes.
 * Flags match stored category and status only.
 */

import type { Prisma } from "@/generated/prisma/client";
import {
  CALL_CATEGORY,
  CALL_STATUS,
  PARKING_ROW_CATEGORIES,
  SUCCESS_ROW_CATEGORIES,
} from "@/modules/traffic/call-class";

export type TrafficRowFlags = {
  phantom?: boolean;
  callErrors?: boolean;
  parking?: boolean;
  failed?: boolean;
  check?: boolean;
  success?: boolean;
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
        in: [...PARKING_ROW_CATEGORIES],
      },
    });
  }
  if (flags.failed) parts.push({ callStatus: CALL_STATUS.failed });
  if (flags.check) parts.push({ callCategory: CALL_CATEGORY.check });
  if (flags.success) {
    parts.push({
      callCategory: {
        in: [...SUCCESS_ROW_CATEGORIES],
      },
      callStatus: CALL_STATUS.success,
    });
  }
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!;
  return { OR: parts };
}
