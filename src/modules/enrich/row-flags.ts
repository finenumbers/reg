/**
 * CDR row classes shared by traffic tables and XLSX writers.
 * Empty billing numbers are exactly "" — not a space, not trim().
 */

import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";

export type CdrRowSides = {
  aNumber: string;
  bNumber: string;
  sideA: string;
  sideB: string;
};

export type CdrRowFlag = "phantom" | "call_error" | null;

export function isCdrEmpty(value: string): boolean {
  return value === "";
}

export function isCdrFilled(value: string): boolean {
  return value !== "";
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
  return null;
}
