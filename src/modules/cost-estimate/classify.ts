/**
 * Cost-estimate call type: Местный / Мобильный / Междугородный / Международный.
 */

import { CALL_TYPE, classifyCallGeography } from "@/modules/traffic/call-class";
import type { TariffAbcRate } from "@/modules/traffic/tariff-match";

export type CostEstimateCallType =
  | typeof CALL_TYPE.local
  | typeof CALL_TYPE.mobile
  | typeof CALL_TYPE.intercity
  | typeof CALL_TYPE.international;

function geographyToCostType(
  geography: "local" | "mobile" | "intercity" | "international",
): CostEstimateCallType {
  switch (geography) {
    case "local":
      return CALL_TYPE.local;
    case "mobile":
      return CALL_TYPE.mobile;
    case "international":
      return CALL_TYPE.international;
    case "intercity":
      return CALL_TYPE.intercity;
    default: {
      const unreachable: never = geography;
      return unreachable;
    }
  }
}

/**
 * Type from A (optional) and B. Empty A cannot yield «Местный».
 * Always treated as outgoing far = B.
 */
export function classifyCostEstimateType(
  aDigits: string,
  bDigits: string,
  rates: readonly TariffAbcRate[],
): CostEstimateCallType {
  const geography = classifyCallGeography(
    aDigits,
    bDigits,
    rates,
    "outgoing",
  );
  return geographyToCostType(geography);
}
