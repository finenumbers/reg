/** A purchased DID number that is not in the RTU catalog. */
export const STATUS_NOT_IN_RTU = "Нет в РТУ";

export type RtuRefresh = {
  enabled: boolean;
  intervalSec: number;
};

/** Cache join for the row color. Not a table column. */
export type PstnLookupStatus = "resolved" | "pending" | "unresolved";

export function parsePstnLookupStatus(
  value: string | null | undefined,
): PstnLookupStatus {
  if (value === "resolved" || value === "unresolved" || value === "pending") {
    return value;
  }
  return "pending";
}

export type RtuItem = {
  id: string;
  category: string;
  city: string;
  region: string;
  abc: string;
  telephone: string;
  supplier: string;
  source: string;
  number: string;
  client: string;
  capacity: string;
  operator: string;
  geography: string;
  title: string;
  activation: string;
  cityAlert: boolean;
  pstnStatus: PstnLookupStatus;
  /** True when the row comes from the DID snapshot and is absent from RTU. */
  missing: boolean;
  /** True when reg_current has this number as Unregistered. */
  unregistered: boolean;
};

export type ListRtuResult = {
  items: RtuItem[];
  total: number;
  page: number;
  pageSize: number;
  refresh: RtuRefresh;
  /** Phone sync time plus the DID snapshot generation. A change reloads the list. */
  catalogStamp: string;
  /** «Заблокировано» in the number list, ignoring search and column filters. */
  blockedCount: number;
  /** Live Unregistered rows in the number list, ignoring search and column filters. */
  unregisteredCount: number;
  /** «Нет в РТУ» rows in the number list, ignoring search and column filters. */
  missingCount: number;
};
