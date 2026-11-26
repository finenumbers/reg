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
  const direction = input.direction.trim();
  let shown: string;
  if (input.registryMissing) {
    shown = collapseShownRegion(input.tariffRegion.trim());
  } else {
    const mobile =
      input.callType === CALL_TYPE.mobile ||
      direction === MOBILE_RF_DIRECTION;
    const source = mobile ? input.pstnGeography : input.tariffRegion;
    shown = collapseShownRegion(source.trim());
  }
  if (!shown && direction) return direction;
  return shown;
}
