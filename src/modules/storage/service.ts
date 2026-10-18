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
import { syslogRoot } from "@/modules/smg-syslog/paths";
import { listSyslogMonthInventory } from "@/modules/smg-syslog/month-inventory";
import { querySmgMonthStats } from "@/modules/smg/month-stats";
import {
  deletableStorageMonthKey,
  mergeStorageMonths,
  type MonthTrafficStats,
} from "@/modules/storage/months";
import { currentUtcMonth } from "@/modules/traffic/cdr-month";
import { queryMonthStatsWithMinutes } from "@/modules/traffic/cdr-month-stats";
import { purgeProgressFromJob } from "@/modules/traffic/purge/progress";

export type StorageMonthRow = {
  year: number;
  month: number;
  key: string;
  incomplete: boolean;
  canDelete: boolean;
  cdrCalls: number;
  cdrSeconds: number;
  cdrMinutes: number;
  smgCalls: number;
  smgSeconds: number;
  smgMinutes: number;
  syslogBytes: number;
};

export type StoragePurgeProgress = ReturnType<typeof purgeProgressFromJob>;

export type StorageSnapshot = {
  months: StorageMonthRow[];
  totalCdrCalls: number;
  totalCdrSeconds: number;
  totalCdrMinutes: number;
  totalSmgCalls: number;
  totalSmgSeconds: number;
  totalSmgMinutes: number;
  totalSyslogBytes: number;
  cdrTableBytes: number;
  smgTableBytes: number;
  /** Sum of every table VACUUM FULL copies. The compress dialog doubles this. */
  tableBytes: number;
  deletableKey: string | null;
  importInFlight: boolean;
  cdrImportInFlight: boolean;
  smgImportInFlight: boolean;
  purgeInFlight: boolean;
  purge: StoragePurgeProgress;
  vacuumInFlight: boolean;
  vacuum: VacuumProgressView | null;
  vacuumFailure: VacuumFailureView | null;
  /** Month rows are omitted while CDR tables are locked. */
  monthsHidden: boolean;
};

type SizeRow = { cdr_bytes: number; smg_bytes: number };

function emptySnapshot(
  flags: Pick<
    StorageSnapshot,
    | "importInFlight"
    | "cdrImportInFlight"
    | "smgImportInFlight"
    | "purgeInFlight"
    | "purge"
    | "vacuumInFlight"
    | "vacuum"
    | "vacuumFailure"
    | "monthsHidden"
  >,
): StorageSnapshot {
  return {
    months: [],
    totalCdrCalls: 0,
    totalCdrSeconds: 0,
    totalCdrMinutes: 0,
    totalSmgCalls: 0,
    totalSmgSeconds: 0,
    totalSmgMinutes: 0,
    totalSyslogBytes: 0,
    cdrTableBytes: 0,
    smgTableBytes: 0,
    tableBytes: 0,
    deletableKey: null,
    ...flags,
  };
}

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
  const cdrImportInFlight = jobRuntime.isInFlight("cdr.import");
  const smgImportInFlight = jobRuntime.isInFlight("smg.import");
  const importInFlight = cdrImportInFlight || smgImportInFlight;

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
    return emptySnapshot({
      importInFlight,
      cdrImportInFlight,
      smgImportInFlight,
      purgeInFlight,
      purge,
      vacuumInFlight: true,
      vacuum,
      vacuumFailure: null,
      monthsHidden: true,
    });
  }

  const [cdrStats, smgStats, sizeRows, syslogMonths] = await Promise.all([
    queryMonthStatsWithMinutes(),
    querySmgMonthStats(),
    prisma.$queryRaw<SizeRow[]>(Prisma.sql`
      SELECT
        (
          pg_total_relation_size('cdr_records') +
          pg_total_relation_size('cdr_voipmonitor_links')
        )::bigint AS cdr_bytes,
        pg_total_relation_size('smg_cdr_records')::bigint AS smg_bytes
    `),
    listSyslogMonthInventory(syslogRoot()),
  ]);
  const toSide = (
    row: {
      year: number;
      month: number;
      key: string;
      count?: number;
      seconds: number;
      minutes: number;
    },
  ): MonthTrafficStats => ({
    year: row.year,
    month: row.month,
    key: row.key,
    calls: row.count ?? 0,
    seconds: row.seconds,
    minutes: row.minutes,
  });
  const merged = mergeStorageMonths(
    cdrStats.map(toSide),
    smgStats.map(toSide),
    syslogMonths,
    current,
  );
  const deletableKey = deletableStorageMonthKey(merged, current.key);
  const busy = purgeInFlight || importInFlight;
  const rows: StorageMonthRow[] = merged.map((item) => ({
    year: item.year,
    month: item.month,
    key: item.key,
    cdrCalls: item.cdrCalls,
    cdrSeconds: item.cdrSeconds,
    cdrMinutes: item.cdrMinutes,
    smgCalls: item.smgCalls,
    smgSeconds: item.smgSeconds,
    smgMinutes: item.smgMinutes,
    syslogBytes: item.syslogBytes,
    incomplete: item.key === current.key,
    canDelete: item.key === deletableKey && !busy,
  }));
  const cdrTableBytes = Number(sizeRows[0]?.cdr_bytes ?? 0);
  const smgTableBytes = Number(sizeRows[0]?.smg_bytes ?? 0);

  return {
    months: rows,
    totalCdrCalls: rows.reduce((sum, row) => sum + row.cdrCalls, 0),
    totalCdrSeconds: rows.reduce((sum, row) => sum + row.cdrSeconds, 0),
    totalCdrMinutes: rows.reduce((sum, row) => sum + row.cdrMinutes, 0),
    totalSmgCalls: rows.reduce((sum, row) => sum + row.smgCalls, 0),
    totalSmgSeconds: rows.reduce((sum, row) => sum + row.smgSeconds, 0),
    totalSmgMinutes: rows.reduce((sum, row) => sum + row.smgMinutes, 0),
    totalSyslogBytes: rows.reduce((sum, row) => sum + row.syslogBytes, 0),
    cdrTableBytes,
    smgTableBytes,
    tableBytes: cdrTableBytes + smgTableBytes,
    deletableKey,
    importInFlight,
    cdrImportInFlight,
    smgImportInFlight,
    purgeInFlight,
    purge,
    vacuumInFlight: false,
    vacuum: null,
    vacuumFailure,
    monthsHidden: false,
  };
}
