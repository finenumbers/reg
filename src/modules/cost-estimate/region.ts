/**
 * Shown «Регион» for cost-estimate — same collapse rules as «Управление РТУ».
 */

import {
  CALL_TYPE,
} from "@/modules/traffic/call-class";
import {
  MOBILE_RF_DIRECTION,
  collapseShownRegion,
} from "@/modules/rtu/columns";

export function shownCostEstimateRegion(input: {
  callType: string;
  direction: string;
  tariffRegion: string;
  pstnGeography: string;
  registryMissing: boolean;
}): string {
  if (input.registryMissing) {
    return collapseShownRegion(input.tariffRegion.trim());
  }
  const mobile =
    input.callType === CALL_TYPE.mobile ||
    input.direction.trim() === MOBILE_RF_DIRECTION;
  const source = mobile ? input.pstnGeography : input.tariffRegion;
  return collapseShownRegion(source.trim());
}
