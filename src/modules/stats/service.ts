import { prisma } from "@/lib/db";
import type { StatsKind } from "@/modules/stats/classify";
import { deviceMonthStatsSql } from "@/modules/stats/sql";
import {
  resolveMonthKey,
  type CdrMonth,
} from "@/modules/traffic/cdr-month";
import { listCachedMonthCounts } from "@/modules/traffic/cdr-month-stats";

export type StatsDeviceRow = {
  name: string;
  inCalls: number;
  inMinutes: number;
  outCalls: number;
  outMinutes: number;
};

export type StatsTableTotals = Omit<StatsDeviceRow, "name">;

export type StatsTable = {
  rows: StatsDeviceRow[];
  totals: StatsTableTotals;
};

export type StatsSnapshot = {
  month: string;
  months: CdrMonth[];
  sip: StatsTable;
  platform: StatsTable;
};

type DeviceStatRow = {
  kind: string;
  device: string;
  in_calls: number;
  in_minutes: number;
  out_calls: number;
  out_minutes: number;
};

const EMPTY_TOTALS: StatsTableTotals = {
  inCalls: 0,
  inMinutes: 0,
  outCalls: 0,
  outMinutes: 0,
};

function emptyTable(): StatsTable {
  return { rows: [], totals: { ...EMPTY_TOTALS } };
}

function asInt(n: number): number {
  return Number(n) || 0;
}

function toDeviceRow(row: DeviceStatRow): StatsDeviceRow {
  return {
    name: row.device,
    inCalls: asInt(row.in_calls),
    inMinutes: asInt(row.in_minutes),
    outCalls: asInt(row.out_calls),
    outMinutes: asInt(row.out_minutes),
  };
}

function buildTable(rows: StatsDeviceRow[]): StatsTable {
  const totals = rows.reduce(
    (acc, row) => ({
      inCalls: acc.inCalls + row.inCalls,
      inMinutes: acc.inMinutes + row.inMinutes,
      outCalls: acc.outCalls + row.outCalls,
      outMinutes: acc.outMinutes + row.outMinutes,
    }),
    { ...EMPTY_TOTALS },
  );
  return { rows, totals };
}

export async function listStatsSnapshot(monthRaw?: string): Promise<StatsSnapshot> {
  const month = resolveMonthKey(monthRaw);
  const [months, raw] = await Promise.all([
    listCachedMonthCounts(),
    prisma.$queryRaw<DeviceStatRow[]>(deviceMonthStatsSql(month.year, month.month)),
  ]);

  const sipRows: StatsDeviceRow[] = [];
  const platformRows: StatsDeviceRow[] = [];
  for (const row of raw) {
    const item = toDeviceRow(row);
    const kind = row.kind as StatsKind;
    if (kind === "sip") sipRows.push(item);
    else if (kind === "platform") platformRows.push(item);
  }

  return {
    month: month.key,
    months,
    sip: sipRows.length ? buildTable(sipRows) : emptyTable(),
    platform: platformRows.length ? buildTable(platformRows) : emptyTable(),
  };
}
