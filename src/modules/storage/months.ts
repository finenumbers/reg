import {
  compareMonthKey,
  deletableMonthKey,
  type CdrMonth,
} from "@/modules/traffic/cdr-month";

export type MonthTrafficStats = {
  year: number;
  month: number;
  key: string;
  calls: number;
  seconds: number;
  minutes: number;
};

export type MergedStorageMonth = {
  year: number;
  month: number;
  key: string;
  /** CDR calls plus SMG calls. The oldest-month rule reads this. */
  count: number;
  cdrCalls: number;
  cdrSeconds: number;
  cdrMinutes: number;
  smgCalls: number;
  smgSeconds: number;
  smgMinutes: number;
};

function blank(row: Pick<CdrMonth, "year" | "month" | "key">): MergedStorageMonth {
  return {
    year: row.year,
    month: row.month,
    key: row.key,
    count: 0,
    cdrCalls: 0,
    cdrSeconds: 0,
    cdrMinutes: 0,
    smgCalls: 0,
    smgSeconds: 0,
    smgMinutes: 0,
  };
}

/** One row per civil month that has CDR rows, SMG rows, or is the current month. */
export function mergeStorageMonths(
  cdr: readonly MonthTrafficStats[],
  smg: readonly MonthTrafficStats[],
  current: CdrMonth,
): MergedStorageMonth[] {
  const byKey = new Map<string, MergedStorageMonth>();
  const ensure = (row: Pick<CdrMonth, "year" | "month" | "key">) => {
    let item = byKey.get(row.key);
    if (!item) {
      item = blank(row);
      byKey.set(row.key, item);
    }
    return item;
  };
  for (const row of cdr) {
    const item = ensure(row);
    item.cdrCalls = row.calls;
    item.cdrSeconds = row.seconds;
    item.cdrMinutes = row.minutes;
  }
  for (const row of smg) {
    const item = ensure(row);
    item.smgCalls = row.calls;
    item.smgSeconds = row.seconds;
    item.smgMinutes = row.minutes;
  }
  if (!byKey.has(current.key)) byKey.set(current.key, blank(current));
  for (const item of byKey.values()) {
    item.count = item.cdrCalls + item.smgCalls;
  }
  return [...byKey.values()].sort((a, b) => compareMonthKey(b.key, a.key));
}

export function deletableStorageMonthKey(
  months: readonly Pick<MergedStorageMonth, "key" | "count">[],
  currentKey: string,
): string | null {
  return deletableMonthKey(months, currentKey);
}
