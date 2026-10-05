/**
 * Side text shared by CDR classification.
 * Empty billing numbers are exactly "" — not a space, not trim().
 */

import { MISSING_BILLING_LABEL } from "@/modules/enrich/types";

export function isSideKnown(side: string): boolean {
  return side !== "" && side !== MISSING_BILLING_LABEL;
}
