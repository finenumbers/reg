import { PARKING_DST } from "@/modules/stats/classify";

export const DETAIL_PSTN_PREFIX = "PSTN_";
export const DETAIL_TRUNK_PREFIX = "Trunk_";
export const DETAIL_LOCAL_SUFFIX = "_Local";
export const DETAIL_LDC_SUFFIX = "_LDC";
export const DETAIL_OLD_SUFFIX = "_OLD";

export { PARKING_DST };

export function isPstnLocal(dstName: string): boolean {
  return dstName.startsWith(DETAIL_PSTN_PREFIX) && dstName.endsWith(DETAIL_LOCAL_SUFFIX);
}

export function isTrunkDst(dstName: string): boolean {
  return dstName.startsWith(DETAIL_TRUNK_PREFIX);
}

export function isPstnLdcOrOld(dstName: string): boolean {
  return (
    dstName.startsWith(DETAIL_PSTN_PREFIX) &&
    (dstName.endsWith(DETAIL_LDC_SUFFIX) || dstName.endsWith(DETAIL_OLD_SUFFIX))
  );
}

export function isParkingDst(dstName: string): boolean {
  return dstName === PARKING_DST;
}

export function hasOutgoingSlice(dstName: string): boolean {
  return isPstnLocal(dstName) || isTrunkDst(dstName) || isPstnLdcOrOld(dstName);
}
