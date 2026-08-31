import { prisma } from "@/lib/db";
import {
  classifySipTrunk,
  type SipTrunkGroup,
  type StatsKind,
} from "@/modules/stats/classify";
import {
  pairPstnRows,
  type PstnJoinRow,
} from "@/modules/stats/pair-pstn";
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
  parkingCalls: number;
  parkingMinutes: number;
  phantomCalls: number;
  phantomMinutes: number;
};

export type { PstnJoinRow };

export type StatsTableTotals = Omit<StatsDeviceRow, "name">;

export type StatsTable = {
  rows: StatsDeviceRow[];
  totals: StatsTableTotals;
};

export type PstnJoinTotals = Omit<PstnJoinRow, "name">;

export type PstnJoinTable = {
  rows: PstnJoinRow[];
  totals: PstnJoinTotals;
};

export type StatsSnapshot = {
  month: string;
  months: CdrMonth[];
  pstnTfop: PstnJoinTable;
  trunk: StatsTable;
  platform: StatsTable;
};

type DeviceStatRow = {
  kind: string;
  device: string;
  in_calls: number;
  in_minutes: number;
  out_calls: number;
  out_minutes: number;
  parking_calls: number;
  parking_minutes: number;
  phantom_calls: number;
  phantom_minutes: number;
};

const EMPTY_TOTALS: StatsTableTotals = {
  inCalls: 0,
  inMinutes: 0,
  outCalls: 0,
  outMinutes: 0,
  parkingCalls: 0,
  parkingMinutes: 0,
  phantomCalls: 0,
  phantomMinutes: 0,
};

const EMPTY_PSTN_TOTALS: PstnJoinTotals = {
  ...EMPTY_TOTALS,
  ldcCalls: 0,
  ldcMinutes: 0,
};

function emptyTable(): StatsTable {
  return { rows: [], totals: { ...EMPTY_TOTALS } };
}

function emptyPstnTable(): PstnJoinTable {
  return { rows: [], totals: { ...EMPTY_PSTN_TOTALS } };
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
    parkingCalls: asInt(row.parking_calls),
    parkingMinutes: asInt(row.parking_minutes),
    phantomCalls: asInt(row.phantom_calls),
    phantomMinutes: asInt(row.phantom_minutes),
  };
}

function buildTable(rows: StatsDeviceRow[]): StatsTable {
  const totals = rows.reduce(
    (acc, row) => ({
      inCalls: acc.inCalls + row.inCalls,
      inMinutes: acc.inMinutes + row.inMinutes,
      outCalls: acc.outCalls + row.outCalls,
      outMinutes: acc.outMinutes + row.outMinutes,
      parkingCalls: acc.parkingCalls + row.parkingCalls,
      parkingMinutes: acc.parkingMinutes + row.parkingMinutes,
      phantomCalls: acc.phantomCalls + row.phantomCalls,
      phantomMinutes: acc.phantomMinutes + row.phantomMinutes,
    }),
    { ...EMPTY_TOTALS },
  );
  return { rows, totals };
}

function buildPstnTable(rows: PstnJoinRow[]): PstnJoinTable {
  const totals = rows.reduce(
    (acc, row) => ({
      inCalls: acc.inCalls + row.inCalls,
      inMinutes: acc.inMinutes + row.inMinutes,
      outCalls: acc.outCalls + row.outCalls,
      outMinutes: acc.outMinutes + row.outMinutes,
      parkingCalls: acc.parkingCalls + row.parkingCalls,
      parkingMinutes: acc.parkingMinutes + row.parkingMinutes,
      phantomCalls: acc.phantomCalls + row.phantomCalls,
      phantomMinutes: acc.phantomMinutes + row.phantomMinutes,
      ldcCalls: acc.ldcCalls + row.ldcCalls,
      ldcMinutes: acc.ldcMinutes + row.ldcMinutes,
    }),
    { ...EMPTY_PSTN_TOTALS },
  );
  return { rows, totals };
}

export async function listStatsSnapshot(monthRaw?: string): Promise<StatsSnapshot> {
  const month = resolveMonthKey(monthRaw);
  const [months, raw] = await Promise.all([
    listCachedMonthCounts(),
    prisma.$queryRaw<DeviceStatRow[]>(deviceMonthStatsSql(month.year, month.month)),
  ]);

  const buckets: Record<SipTrunkGroup | "platform", StatsDeviceRow[]> = {
    pstnTfop: [],
    pstnLdc: [],
    trunk: [],
    platform: [],
  };
  for (const row of raw) {
    const item = toDeviceRow(row);
    const kind = row.kind as StatsKind;
    if (kind === "platform") {
      buckets.platform.push(item);
      continue;
    }
    if (kind === "sip") {
      const group = classifySipTrunk(item.name);
      if (group) buckets[group].push(item);
    }
  }

  return {
    month: month.key,
    months,
    pstnTfop: pstnTableOrEmpty(
      pairPstnRows([...buckets.pstnTfop, ...buckets.pstnLdc]),
    ),
    trunk: tableOrEmpty(buckets.trunk),
    platform: tableOrEmpty(buckets.platform),
  };
}

function pstnTableOrEmpty(rows: PstnJoinRow[]): PstnJoinTable {
  return rows.length ? buildPstnTable(rows) : emptyPstnTable();
}

function tableOrEmpty(rows: StatsDeviceRow[]): StatsTable {
  return rows.length ? buildTable(rows) : emptyTable();
}
