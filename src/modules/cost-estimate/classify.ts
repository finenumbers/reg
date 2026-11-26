/**
 * Cost-estimate call type: only Мобильный / Междугородный / Международный.
 */

import { CALL_TYPE, classifyCallGeography } from "@/modules/traffic/call-class";
import type { TariffAbcRate } from "@/modules/traffic/tariff-match";

export type CostEstimateCallType =
  | typeof CALL_TYPE.mobile
  | typeof CALL_TYPE.intercity
  | typeof CALL_TYPE.international;

function geographyToCostType(
  geography: "local" | "mobile" | "intercity" | "international",
): CostEstimateCallType {
  switch (geography) {
    case "mobile":
      return CALL_TYPE.mobile;
    case "international":
      return CALL_TYPE.international;
    case "intercity":
      return CALL_TYPE.intercity;
    case "local":
      // Section contract: no «Местный».
      return CALL_TYPE.intercity;
    default: {
      const unreachable: never = geography;
      return unreachable;
    }
  }
}

/** Type from B only (empty ANI). */
export function classifyCostEstimateType(
  bDigits: string,
  rates: readonly TariffAbcRate[],
): CostEstimateCallType {
  const geography = classifyCallGeography("", bDigits, rates, "outgoing");
  return geographyToCostType(geography);
}
