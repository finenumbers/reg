/**
 * A tariff file records resplit debt in the snapshot transaction.
 * This wakes the same catalog queue. It does not update the catalogs itself.
 */

import { requestDecorateCatchUp } from "@/modules/numbering-catalog/decorate";

export {
  RESPLIT_AURORA_LOCK_SQL,
  RESPLIT_EXOLVE_LOCK_SQL,
  RESPLIT_LOCKS,
  RESPLIT_MCN_LOCK_SQL,
  RESPLIT_RUNEXIS_LOCK_SQL,
  RESPLIT_SIPOUT_LOCK_SQL,
  RESPLIT_UIS_LOCK_SQL,
  RESPLIT_VOXIMPLANT_LOCK_SQL,
} from "@/modules/numbering-sync/locks";

/** The tariff snapshot already incremented the resplit epoch. */
export function requestNumberingResplit(): void {
  requestDecorateCatchUp();
}
