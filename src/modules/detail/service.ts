import { prisma } from "@/lib/db";
import { clientMonthStatsSql } from "@/modules/detail/sql";
import type { DetailMetricRow } from "@/modules/detail/sort";
import {
  resolveMonthKey,
  type CdrMonth,
} from "@/modules/traffic/cdr-month";
import { listCachedMonthCounts } from "@/modules/traffic/cdr-month-stats";

export type { DetailMetricRow };

export type DetailTableTotals = Omit<DetailMetricRow, "client">;

export type DetailSnapshot = {
  month: string;
  months: CdrMonth[];
  rows: DetailMetricRow[];
  totals: DetailTableTotals;
};

type ClientStatRow = {
  client: string;
  in_calls: number;
  in_minutes: number;
  out_calls: number;
  out_minutes: number;
  parking_calls: number;
  parking_minutes: number;
  external_calls: number;
  external_minutes: number;
  ldc_calls: number;
  ldc_minutes: number;
};

const EMPTY_TOTALS: DetailTableTotals = {
  inCalls: 0,
  inMinutes: 0,
  outCalls: 0,
  outMinutes: 0,
  parkingCalls: 0,
  parkingMinutes: 0,
  externalCalls: 0,
  externalMinutes: 0,
  ldcCalls: 0,
  ldcMinutes: 0,
};

function asInt(n: number): number {
  return Number(n) || 0;
}

function toMetricRow(row: ClientStatRow): DetailMetricRow {
  return {
    client: row.client,
    inCalls: asInt(row.in_calls),
    inMinutes: asInt(row.in_minutes),
    outCalls: asInt(row.out_calls),
    outMinutes: asInt(row.out_minutes),
    parkingCalls: asInt(row.parking_calls),
    parkingMinutes: asInt(row.parking_minutes),
    externalCalls: asInt(row.external_calls),
    externalMinutes: asInt(row.external_minutes),
    ldcCalls: asInt(row.ldc_calls),
    ldcMinutes: asInt(row.ldc_minutes),
  };
}

function buildTotals(rows: DetailMetricRow[]): DetailTableTotals {
  return rows.reduce(
    (acc, row) => ({
      inCalls: acc.inCalls + row.inCalls,
      inMinutes: acc.inMinutes + row.inMinutes,
      outCalls: acc.outCalls + row.outCalls,
      outMinutes: acc.outMinutes + row.outMinutes,
      parkingCalls: acc.parkingCalls + row.parkingCalls,
      parkingMinutes: acc.parkingMinutes + row.parkingMinutes,
      externalCalls: acc.externalCalls + row.externalCalls,
      externalMinutes: acc.externalMinutes + row.externalMinutes,
      ldcCalls: acc.ldcCalls + row.ldcCalls,
      ldcMinutes: acc.ldcMinutes + row.ldcMinutes,
    }),
    { ...EMPTY_TOTALS },
  );
}

export async function listDetailSnapshot(monthRaw?: string): Promise<DetailSnapshot> {
  const month = resolveMonthKey(monthRaw);
  const [months, raw] = await Promise.all([
    listCachedMonthCounts(),
    prisma.$queryRaw<ClientStatRow[]>(clientMonthStatsSql(month.year, month.month)),
  ]);
  const rows = raw.map(toMetricRow);
  return {
    month: month.key,
    months,
    rows,
    totals: rows.length ? buildTotals(rows) : { ...EMPTY_TOTALS },
  };
}
