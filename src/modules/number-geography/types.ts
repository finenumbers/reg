export type NumberGeographyRefresh = {
  enabled: boolean;
  intervalSec: number;
};

export type NumberGeographyItem = {
  id: string;
  city: string;
  supplier: string;
  number: string;
  client: string;
  capacity: string;
  operator: string;
  geography: string;
  title: string;
  cityAlert: boolean;
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
