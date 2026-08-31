import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { jobRuntime } from "@/modules/jobs/runtime";
import {
  currentUtcMonth,
  deletableMonthKey,
  parseMonthKey,
  withCurrentMonth,
  type CdrMonth,
} from "@/modules/traffic/cdr-month";
import { queryMonthStatsWithMinutes } from "@/modules/traffic/cdr-month-stats";

export type StorageMonthRow = CdrMonth & {
  calls: number;
  seconds: number;
  minutes: number;
  incomplete: boolean;
  canDelete: boolean;
};

export type StoragePurgeProgress = {
  month: string;
  deleted: number;
  target: number;
} | null;

export type StorageSnapshot = {
  months: StorageMonthRow[];
  totalCalls: number;
  totalSeconds: number;
  totalMinutes: number;
  tableBytes: number;
  deletableKey: string | null;
  importInFlight: boolean;
  purgeInFlight: boolean;
  purge: StoragePurgeProgress;
};

type SizeRow = { bytes: number };

export async function listStorageSnapshot(): Promise<StorageSnapshot> {
  const current = currentUtcMonth();
  const [stats, sizeRows] = await Promise.all([
    queryMonthStatsWithMinutes(),
    prisma.$queryRaw<SizeRow[]>(Prisma.sql`
      SELECT
        (
          pg_total_relation_size('cdr_records') +
          pg_total_relation_size('cdr_voipmonitor_links')
        )::bigint AS bytes
    `),
  ]);
  const months = withCurrentMonth(
    stats.map((row) => ({
      year: row.year,
      month: row.month,
      key: row.key,
      count: row.count ?? 0,
    })),
    current,
  );
  const secondsByKey = new Map(stats.map((row) => [row.key, row.seconds]));
  const minutesByKey = new Map(stats.map((row) => [row.key, row.minutes]));
  const deletableKey = deletableMonthKey(months, current.key);
  const purgeInFlight = jobRuntime.isInFlight("cdr.purge.month");
  const importInFlight = jobRuntime.isInFlight("cdr.import");
  let purge: StoragePurgeProgress = null;
  if (purgeInFlight) {
    const running = await prisma.jobRun.findFirst({
      where: { actionCode: "cdr.purge.month", status: "running" },
      orderBy: { startedAt: "desc" },
      select: { meta: true, phonesParsed: true },
    });
    const meta =
      running?.meta && typeof running.meta === "object"
        ? (running.meta as Record<string, unknown>)
        : null;
    const month =
      typeof meta?.month === "string" ? parseMonthKey(meta.month)?.key : null;
    if (month) {
      purge = {
        month,
        deleted: running?.phonesParsed ?? 0,
        target:
          typeof meta?.targetCount === "number"
            ? meta.targetCount
            : Number(meta?.targetCount) || 0,
      };
    }
  }

  const rows: StorageMonthRow[] = months.map((item) => ({
    ...item,
    calls: item.count ?? 0,
    seconds: secondsByKey.get(item.key) ?? 0,
    minutes: minutesByKey.get(item.key) ?? 0,
    incomplete: item.key === current.key,
    canDelete: item.key === deletableKey && !purgeInFlight && !importInFlight,
  }));

  return {
    months: rows,
    totalCalls: rows.reduce((sum, row) => sum + row.calls, 0),
    totalSeconds: rows.reduce((sum, row) => sum + row.seconds, 0),
    totalMinutes: rows.reduce((sum, row) => sum + row.minutes, 0),
    tableBytes: Number(sizeRows[0]?.bytes ?? 0),
    deletableKey,
    importInFlight,
    purgeInFlight,
    purge,
  };
}
