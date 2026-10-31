export type NumberGeographyRefresh = {
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

export type NumberGeographyItem = {
  id: string;
  category: string;
  city: string;
  supplier: string;
  number: string;
  client: string;
  capacity: string;
  operator: string;
  geography: string;
  title: string;
  cityAlert: boolean;
  pstnStatus: PstnLookupStatus;
};

export type ListNumberGeographyResult = {
  items: NumberGeographyItem[];
  total: number;
  page: number;
  pageSize: number;
  refresh: NumberGeographyRefresh;
  /** `max(lastSyncedAt)` of phone endpoints. Changes when phones.sync replaces the catalog. */
  catalogStamp: string;
};
