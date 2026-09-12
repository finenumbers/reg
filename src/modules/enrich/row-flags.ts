/**
 * CDR row classes shared by traffic tables and XLSX writers.
 * Empty billing numbers are exactly "" — not a space, not trim().
 */

import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";

/** Exact «Объект набора» value. Keep equal to stats PARKING_DST. */
export const PARKING_DIAL_OBJECT = "Service_Parking";

export type CdrRowSides = {
  aNumber: string;
  bNumber: string;
  sideA: string;
  sideB: string;
  dialObject: string;
};

export type CdrRowFlag = "phantom" | "call_error" | "parking_known" | null;

export function isCdrEmpty(value: string): boolean {
  return value === "";
}

export function isCdrFilled(value: string): boolean {
  return value !== "";
}

export function isSideKnown(side: string): boolean {
  return side !== "" && side !== MISSING_BILLING_LABEL;
}

export function classifyCdrRow(row: CdrRowSides): CdrRowFlag {
  if (isCdrEmpty(row.aNumber) && isCdrEmpty(row.bNumber)) return "call_error";
  if (
    isCdrFilled(row.aNumber) &&
    isCdrFilled(row.bNumber) &&
    row.sideA === MISSING_BILLING_LABEL &&
    row.sideB === MISSING_BILLING_LABEL
  ) {
    return "phantom";
  }
  if (
    row.dialObject.trim() === PARKING_DIAL_OBJECT &&
    (isSideKnown(row.sideA) || isSideKnown(row.sideB))
  ) {
    return "parking_known";
  }
  return null;
}
