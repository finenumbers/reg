export type NumberingRow = {
  id: number;
  abc: string;
  rangeStart: number;
  rangeEnd: number;
  capacity: number;
  operator: string;
  garTerritory: string;
  inn: string;
  uvrAntifraud: number | null;
};

export type ListNumberingResult = {
  items: NumberingRow[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
};

export type NumberingSummaryCounts = {
  rangeCount: number;
  totalCapacity: number;
  uniqueGarTerritories: number;
  uniqueOperators: number;
};

export type NumberingSummary = {
  filtered: NumberingSummaryCounts & { totalCapacityPending: boolean };
  global: NumberingSummaryCounts;
};
