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
  /** CDR calls plus SMG calls, plus one when the month has syslog files. */
  count: number;
  cdrCalls: number;
  cdrSeconds: number;
  cdrMinutes: number;
  smgCalls: number;
  smgSeconds: number;
  smgMinutes: number;
  syslogBytes: number;
  syslogFiles: number;
  syslogPresent: boolean;
};

export type SyslogMonthPresence = {
  year: number;
  month: number;
  key: string;
  bytes: number;
  files: number;
  present: boolean;
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
    syslogBytes: 0,
    syslogFiles: 0,
    syslogPresent: false,
  };
}

/** One row per month that has CDR rows, SMG rows, syslog files, or is current. */
export function mergeStorageMonths(
  cdr: readonly MonthTrafficStats[],
  smg: readonly MonthTrafficStats[],
  syslog: readonly SyslogMonthPresence[],
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
  for (const row of syslog) {
    if (!row.present) continue;
    const item = ensure(row);
    item.syslogBytes = row.bytes;
    item.syslogFiles = row.files;
    item.syslogPresent = true;
  }
  if (!byKey.has(current.key)) byKey.set(current.key, blank(current));
  for (const item of byKey.values()) {
    item.count = item.cdrCalls + item.smgCalls + (item.syslogPresent ? 1 : 0);
  }
  return [...byKey.values()].sort((a, b) => compareMonthKey(b.key, a.key));
}

export function deletableStorageMonthKey(
  months: readonly Pick<MergedStorageMonth, "key" | "count">[],
  currentKey: string,
): string | null {
  return deletableMonthKey(months, currentKey);
}
