/**
 * SipOut access settings. Saving the key does not call SipOut.
 */

export type { NumberingLoadView } from "@/modules/numbering-load/schemas";
export {
  getSipoutAccessView as getNumberingLoadView,
  saveSipoutKey,
  testSipoutAccess,
} from "@/modules/numbering-sync/service";
