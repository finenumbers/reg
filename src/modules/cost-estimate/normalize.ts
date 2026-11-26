/**
 * B-number and duration shapes for cost-estimate rating.
 */

import { isTariffNumberAdmitted } from "@/modules/traffic/tariff-match";

/** Digits only from a displayed E.164 (strips +, spaces, punctuation). */
export function digitsFromE164(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Admitted tariff B-number, or null.
 * No 8→7 conversion. Leading + must already be stripped via digitsFromE164.
 */
export function normalizeCostEstimateBNumber(raw: string): string | null {
  const digits = digitsFromE164(raw);
  if (!isTariffNumberAdmitted(digits)) return null;
  return digits;
}

/** CDR-style elapsed_time ms string for rateCdrCall. */
export function secondsToElapsedMsString(seconds: number): string {
  if (!Number.isInteger(seconds) || seconds < 0) {
    throw new Error("seconds must be a non-negative integer");
  }
  return String(BigInt(seconds) * BigInt(1000));
}
