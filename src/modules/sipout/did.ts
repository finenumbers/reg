/**
 * SipOut `did` as the digit string the tariff split already accepts.
 * A leading plus is the only decoration that is removed.
 */

import { isTariffNumberAdmitted } from "@/modules/traffic/tariff-match";

export function sipoutDidDigits(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const body = trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
  if (!isTariffNumberAdmitted(body)) return null;
  return body;
}
