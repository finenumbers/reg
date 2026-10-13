import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { jobRuntime } from "@/modules/jobs/runtime";
import { isDatabaseVacuumActive } from "@/modules/storage/vacuum/gate";
import {
  vacuumClusterFromRow,
  vacuumViews,
  VACUUM_INTERRUPT_NOTE,
  type VacuumClusterRow,
  type VacuumFailureView,
  type VacuumProgressView,
} from "@/modules/storage/vacuum/progress";
import {
  currentUtcMonth,
  deletableMonthKey,
  withCurrentMonth,
  type CdrMonth,
} from "@/modules/traffic/cdr-month";
import { queryMonthStatsWithMinutes } from "@/modules/traffic/cdr-month-stats";
import { purgeProgressFromJob } from "@/modules/traffic/purge/progress";

export type StorageMonthRow = CdrMonth & {
  calls: number;
  seconds: number;
  minutes: number;
  incomplete: boolean;
  canDelete: boolean;
};

export type StoragePurgeProgress = ReturnType<typeof purgeProgressFromJob>;

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
  vacuumInFlight: boolean;
  vacuum: VacuumProgressView | null;
  vacuumFailure: VacuumFailureView | null;
  /** Month rows are omitted while CDR tables are locked. */
  monthsHidden: boolean;
};

type SizeRow = { bytes: number };

async function readVacuumCluster(): Promise<VacuumClusterRow | null> {
  try {
    const rows = await prisma.$queryRaw<
      {
        relname: string;
        phase: string | null;
        scanned: unknown;
        written: unknown;
      }[]
    >(Prisma.sql`
      SELECT c.relname::text AS relname,
             p.phase::text AS phase,
             p.heap_tuples_scanned AS scanned,
             p.heap_tuples_written AS written
      FROM pg_stat_progress_cluster p
      JOIN pg_class c ON c.oid = p.relid
      WHERE p.command = 'VACUUM FULL'
      LIMIT 1
    `);
    return vacuumClusterFromRow(rows[0] ?? null);
  } catch {
    return null;
  }
}

async function latestVacuumJob(): Promise<{
  status: string;
  errorMessage: string | null;
  meta: unknown;
} | null> {
  return prisma.jobRun.findFirst({
    where: { actionCode: "db.vacuum" },
    orderBy: { startedAt: "desc" },
    select: { status: true, errorMessage: true, meta: true },
  });
}

export async function listStorageSnapshot(): Promise<StorageSnapshot> {
  const current = currentUtcMonth();
  const vacuumInFlight = isDatabaseVacuumActive();
  const purgeInFlight = jobRuntime.isInFlight("cdr.purge.month");
  const importInFlight = jobRuntime.isInFlight("cdr.import");

  let purge: StoragePurgeProgress = null;
  if (purgeInFlight) {
    const running = await prisma.jobRun.findFirst({
      where: { actionCode: "cdr.purge.month", status: "running" },
      orderBy: { startedAt: "desc" },
      select: { meta: true, phonesParsed: true },
    });
    purge = purgeProgressFromJob({
      phonesParsed: running?.phonesParsed ?? null,
      meta: running?.meta ?? null,
    });
  }

  let vacuum: VacuumProgressView | null = null;
  let vacuumFailure: VacuumFailureView | null = null;
  if (vacuumInFlight) {
    const [running, cluster] = await Promise.all([
      prisma.jobRun.findFirst({
        where: { actionCode: "db.vacuum", status: "running" },
        orderBy: { startedAt: "desc" },
        select: { meta: true },
      }),
      readVacuumCluster(),
    ]);
    const view = vacuumViews({
      meta: running?.meta ?? null,
      cluster,
    });
    vacuum = { stages: view.stages, note: VACUUM_INTERRUPT_NOTE };
  } else {
    const last = await latestVacuumJob();
    if (last?.status === "failed") {
      const view = vacuumViews({
        meta: last.meta,
        errorMessage: last.errorMessage,
        failed: true,
      });
      vacuumFailure = {
        stages: view.stages,
        message: view.message ?? "Сжатие прервано",
      };
    }
  }

  if (vacuumInFlight) {
    return {
      months: [],
      totalCalls: 0,
      totalSeconds: 0,
      totalMinutes: 0,
      tableBytes: 0,
      deletableKey: null,
      importInFlight,
      purgeInFlight,
      purge,
      vacuumInFlight: true,
      vacuum,
      vacuumFailure: null,
      monthsHidden: true,
    };
  }

  const [stats, sizeRows] = await Promise.all([
    queryMonthStatsWithMinutes(),
    prisma.$queryRaw<SizeRow[]>(Prisma.sql`
      SELECT
        (
          pg_total_relation_size('cdr_records') +
          pg_total_relation_size('cdr_voipmonitor_links') +
          pg_total_relation_size('smg_cdr_records')
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
    vacuumInFlight: false,
    vacuum: null,
    vacuumFailure,
    monthsHidden: false,
  };
}
