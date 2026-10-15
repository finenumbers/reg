/**
 * One dashboard snapshot for every open tab.
 * Session callers share a short cache. A CDR month scan, when it runs,
 * is the same single-flight cache the traffic page already uses.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { jobRuntime } from "@/modules/jobs/runtime";
import { findLastFileImport } from "@/modules/jobs/last-file-import";
import { lastRtuEmptyScanAt, lastSmgEmptyScanAt } from "@/modules/jobs/scheduler";
import { hasPermission } from "@/modules/rbac/permissions";
import { listSmgInboxFiles } from "@/modules/smg/inbox";
import { listSmgPoisonEntries } from "@/modules/smg/poison";
import { readStatus } from "@/modules/smg-syslog/status";
import { syslogRoot } from "@/modules/smg-syslog/paths";
import {
  isDatabaseVacuumActive,
  CDR_VACUUM_BUSY_MESSAGE,
} from "@/modules/storage/vacuum/gate";
import { countInboxFiles } from "@/modules/traffic/inbox";
import { currentUtcMonth } from "@/modules/traffic/cdr-month";
import {
  listCachedMonthCounts,
  peekCachedMonthCounts,
} from "@/modules/traffic/cdr-month-stats";
import { isPurgeHoldError, listPoisonEntries } from "@/modules/traffic/poison";
import {
  buildDashboard,
  cachedMonthCalls,
  clipError,
  isDashboardPoison,
  toDashboardSnapshot,
  type DashboardFacts,
  type ImportPulse,
  type PulseStatus,
  type ScheduledPulse,
  type SyslogPulse,
} from "@/modules/dashboard/rules";
import type { DashboardSnapshot } from "@/modules/dashboard/types";

const CACHE_TTL_MS = 15_000;
const CACHE_KEY = "__reg_dashboard_snapshot__";

const LATEST_ACTIONS = [
  "regs.poll",
  "phones.sync",
  "groups.sync",
  "cdr.import",
  "smg.import",
  "cdr.purge.month",
  "db.vacuum",
] as const;

const SUCCESS_ACTIONS = ["regs.poll", "phones.sync", "groups.sync"] as const;

type JobHead = {
  action_code: string;
  status: string;
  started_at: Date | string;
  finished_at: Date | string | null;
  error_message: string | null;
};

type SuccessHead = {
  action_code: string;
  started_at: Date | string;
  finished_at: Date | string | null;
};

type CacheStore = {
  entries: Map<string, { at: number; value: DashboardSnapshot }>;
  inflight: Map<string, Promise<DashboardSnapshot>>;
};

function cacheStore(): CacheStore {
  const g = globalThis as typeof globalThis & { [CACHE_KEY]?: CacheStore };
  if (!g[CACHE_KEY]) {
    g[CACHE_KEY] = { entries: new Map(), inflight: new Map() };
  }
  return g[CACHE_KEY];
}

function permissionKey(permissions: readonly string[]): string {
  const regs = hasPermission(permissions, "regs:read") ? "r" : "";
  const phones = hasPermission(permissions, "phones:read") ? "p" : "";
  return `${regs}${phones}`;
}

export async function getDashboardSnapshot(
  permissions: readonly string[],
): Promise<DashboardSnapshot> {
  const key = permissionKey(permissions);
  const store = cacheStore();
  const now = Date.now();
  const hit = store.entries.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.value;

  const pending = store.inflight.get(key);
  if (pending) return pending;

  const promise = buildFresh(permissions, now)
    .then((value) => {
      cacheStore().entries.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => {
      cacheStore().inflight.delete(key);
    });
  store.inflight.set(key, promise);
  return promise;
}

async function buildFresh(
  permissions: readonly string[],
  now: number,
): Promise<DashboardSnapshot> {
  const facts = await gatherFacts(permissions, now);
  return {
    ...toDashboardSnapshot(buildDashboard(facts)),
    calls: hasPermission(permissions, "phones:read"),
  };
}

async function gatherFacts(
  permissions: readonly string[],
  now: number,
): Promise<DashboardFacts> {
  const includeRegs = hasPermission(permissions, "regs:read");
  const includePhones = hasPermission(permissions, "phones:read");
  const base = emptyFacts(now, includePhones);
  if (!includeRegs && !includePhones) return base;

  const [settings, jobs, regCounts, phoneState, groupState] = await Promise.all([
    soft(() =>
      prisma.appSetting.findUnique({
        where: { id: 1 },
        select: {
          regsPollEnabled: true,
          regsPollIntervalSec: true,
          exportSyncEnabled: true,
          exportSyncIntervalSec: true,
          syslogEnabled: true,
        },
      }),
    ),
    soft(loadJobs),
    includeRegs ? soft(loadRegCounts) : Promise.resolve(null),
    includePhones ? soft(loadPhoneState) : Promise.resolve(null),
    includePhones ? soft(loadGroupState) : Promise.resolve(null),
  ]);

  const jobsOk = jobs != null;
  const latest = jobs?.latest ?? new Map<string, JobHead>();
  const successAt = jobs?.successAt ?? new Map<string, number>();
  const vacuumActive =
    isDatabaseVacuumActive() ||
    jobRuntime.isInFlight("db.vacuum") ||
    latest.get("db.vacuum")?.status === "running";
  const purgeActive =
    jobRuntime.isInFlight("cdr.purge.month") ||
    latest.get("cdr.purge.month")?.status === "running";

  const regsEnabled = settings?.regsPollEnabled ?? false;
  const exportEnabled = settings?.exportSyncEnabled ?? false;
  const syslogEnabled = settings?.syslogEnabled ?? false;

  let traffic: DashboardFacts["traffic"] = null;
  let smg: DashboardFacts["smg"] = null;
  let syslog: SyslogPulse | null = null;
  if (includePhones) {
    const [trafficExtra, smgExtra, syslogPulse] = await Promise.all([
      loadTrafficExtra(now, vacuumActive),
      loadSmgExtra(),
      soft(() => Promise.resolve(readSyslog(syslogEnabled))),
    ]);
    traffic = {
      ...importPulse("cdr.import", latest),
      ...trafficExtra,
    };
    smg = {
      ...importPulse("smg.import", latest),
      ...smgExtra,
    };
    syslog = syslogPulse;
  }

  return {
    now,
    regsIntervalSec: settings?.regsPollIntervalSec ?? 60,
    exportIntervalSec: settings?.exportSyncIntervalSec ?? 300,
    jobsOk,
    regs: includeRegs
      ? {
          ...scheduledPulse("regs.poll", regsEnabled, latest, successAt),
          registered: regCounts?.registered ?? null,
          unregistered: regCounts?.unregistered ?? null,
          total: regCounts?.total ?? null,
        }
      : null,
    phones: includePhones
      ? {
          ...scheduledPulse("phones.sync", exportEnabled, latest, successAt),
          endpointCount: phoneState?.endpointCount ?? null,
          gatewayCount: phoneState?.gatewayCount ?? null,
        }
      : null,
    groups: includePhones
      ? {
          ...scheduledPulse("groups.sync", exportEnabled, latest, successAt),
          groupCount: groupState?.groupCount ?? null,
        }
      : null,
    traffic,
    smg,
    syslog,
    vacuumActive,
    purgeActive,
    showMaintenance: includePhones,
  };
}

function emptyFacts(now: number, showMaintenance: boolean): DashboardFacts {
  return {
    now,
    regsIntervalSec: 60,
    exportIntervalSec: 300,
    jobsOk: true,
    regs: null,
    phones: null,
    groups: null,
    traffic: null,
    smg: null,
    syslog: null,
    vacuumActive: false,
    purgeActive: false,
    showMaintenance,
  };
}

async function loadJobs(): Promise<{
  latest: Map<string, JobHead>;
  successAt: Map<string, number>;
}> {
  const [latestRows, successRows] = await Promise.all([
    prisma.$queryRaw<JobHead[]>(Prisma.sql`
      SELECT DISTINCT ON ("actionCode")
        "actionCode" AS action_code,
        status::text AS status,
        "startedAt" AS started_at,
        "finishedAt" AS finished_at,
        "errorMessage" AS error_message
      FROM job_runs
      WHERE "actionCode" IN (${Prisma.join([...LATEST_ACTIONS])})
      ORDER BY "actionCode", "startedAt" DESC
    `),
    prisma.$queryRaw<SuccessHead[]>(Prisma.sql`
      SELECT DISTINCT ON ("actionCode")
        "actionCode" AS action_code,
        "startedAt" AS started_at,
        "finishedAt" AS finished_at
      FROM job_runs
      WHERE status::text = 'success'
        AND "actionCode" IN (${Prisma.join([...SUCCESS_ACTIONS])})
      ORDER BY "actionCode", "startedAt" DESC
    `),
  ]);

  const successAt = new Map<string, number>();
  for (const row of successRows) {
    const at = asTime(row.finished_at) ?? asTime(row.started_at);
    if (at != null) successAt.set(row.action_code, at);
  }
  return {
    latest: new Map(latestRows.map((row) => [row.action_code, row])),
    successAt,
  };
}

async function loadRegCounts(): Promise<{
  registered: number;
  unregistered: number;
  total: number;
}> {
  const grouped = await prisma.registrationCurrent.groupBy({
    by: ["status"],
    _count: true,
  });
  let registered = 0;
  let unregistered = 0;
  let total = 0;
  for (const row of grouped) {
    const count = typeof row._count === "number" ? row._count : 0;
    total += count;
    if (row.status === "Registered") registered = count;
    if (row.status === "Unregistered") unregistered = count;
  }
  return { registered, unregistered, total };
}

async function loadPhoneState(): Promise<{
  endpointCount: number;
  gatewayCount: number;
}> {
  const row = await prisma.phoneImportState.findUnique({
    where: { id: 1 },
    select: { endpointCount: true, gatewayCount: true },
  });
  return {
    endpointCount: row?.endpointCount ?? 0,
    gatewayCount: row?.gatewayCount ?? 0,
  };
}

async function loadGroupState(): Promise<{ groupCount: number }> {
  const row = await prisma.routingGroupImportState.findUnique({
    where: { id: 1 },
    select: { groupCount: true },
  });
  return { groupCount: row?.groupCount ?? 0 };
}

function scheduledPulse(
  code: (typeof SUCCESS_ACTIONS)[number],
  enabled: boolean,
  latest: Map<string, JobHead>,
  successAt: Map<string, number>,
): ScheduledPulse {
  const row = latest.get(code);
  const status = asStatus(row?.status);
  const running = jobRuntime.isInFlight(code) || status === "running";
  return {
    enabled,
    running,
    lastStatus: status,
    lastSuccessAt: successAt.get(code) ?? null,
    lastError: status === "failed" ? (row?.error_message ?? null) : null,
  };
}

function importPulse(
  code: "cdr.import" | "smg.import",
  latest: Map<string, JobHead>,
): ImportPulse {
  const row = latest.get(code);
  const status = asStatus(row?.status);
  const running = jobRuntime.isInFlight(code) || status === "running";
  return {
    running,
    lastStatus: status,
    lastError: status === "failed" ? (row?.error_message ?? null) : null,
    pendingReady: null,
    poisonCount: null,
    poisonLabel: null,
    loadKnown: false,
    lastPassAt: null,
    hadCalls: false,
    lastCheckedAt: null,
  };
}

async function loadTrafficExtra(
  now: number,
  vacuum: boolean,
): Promise<
  Pick<
    DashboardFacts["traffic"] & object,
    | "pendingReady"
    | "poisonCount"
    | "poisonLabel"
    | "loadKnown"
    | "lastPassAt"
    | "hadCalls"
    | "lastCheckedAt"
    | "monthCalls"
    | "monthNote"
  >
> {
  const [inbox, poison, pass, month] = await Promise.all([
    soft(countInboxFiles),
    soft(() => Promise.resolve(listPoisonEntries())),
    soft(() => findLastFileImport("cdr.import")),
    readMonthCalls(now, vacuum),
  ]);
  const actionable = (poison ?? []).filter((item) =>
    isDashboardPoison(item.error, item.heldForPurge),
  );
  const first = actionable[0];
  return {
    pendingReady: inbox?.pending ?? null,
    poisonCount: poison == null ? null : actionable.length,
    poisonLabel: first ? `${first.filename}: ${clipError(first.error)}` : null,
    loadKnown: pass != null,
    lastPassAt: asTime(pass?.lastPassAt ?? null),
    hadCalls: pass?.hadCalls ?? false,
    lastCheckedAt: lastRtuEmptyScanAt(),
    monthCalls: month.calls,
    monthNote: month.note,
  };
}

async function loadSmgExtra(): Promise<
  Pick<
    ImportPulse,
    | "pendingReady"
    | "poisonCount"
    | "poisonLabel"
    | "loadKnown"
    | "lastPassAt"
    | "hadCalls"
    | "lastCheckedAt"
  >
> {
  const [files, poison, pass] = await Promise.all([
    soft(listSmgInboxFiles),
    soft(() => Promise.resolve(listSmgPoisonEntries())),
    soft(() => findLastFileImport("smg.import")),
  ]);
  const actionable = (poison ?? []).filter((item) =>
    isDashboardPoison(item.error, isPurgeHoldError(item.error)),
  );
  const first = actionable[0];
  return {
    pendingReady: files?.ready.length ?? null,
    poisonCount: poison == null ? null : actionable.length,
    poisonLabel: first ? `${first.filename}: ${clipError(first.error)}` : null,
    loadKnown: pass != null,
    lastPassAt: asTime(pass?.lastPassAt ?? null),
    hadCalls: pass?.hadCalls ?? false,
    lastCheckedAt: lastSmgEmptyScanAt(),
  };
}

function readSyslog(enabled: boolean): SyslogPulse {
  const status = readStatus(syslogRoot());
  const updatedAt = status ? Date.parse(status.updatedAt) : null;
  return {
    enabled,
    filePresent: status != null,
    updatedAt: updatedAt != null && Number.isFinite(updatedAt) ? updatedAt : null,
    listening: status?.listening ?? false,
    bindError: status?.bindError ?? null,
    lowSpace: status?.lowSpace ?? false,
    freeBytes: status?.freeBytes ?? null,
    unknownTotal: status?.unknownTotal ?? 0,
    lastPacketAt: status ? latestPacket(status.lastPacket) : null,
  };
}

async function readMonthCalls(
  now: number,
  vacuum: boolean,
): Promise<{ calls: number | null; note: string | null }> {
  const key = currentUtcMonth(new Date(now)).key;
  if (vacuum) {
    const calls = cachedMonthCalls(peekCachedMonthCounts(), key);
    return calls == null
      ? { calls: null, note: CDR_VACUUM_BUSY_MESSAGE }
      : { calls, note: null };
  }
  try {
    const months = await listCachedMonthCounts(now);
    const row = months.find((item) => item.key === key);
    return { calls: row?.count ?? 0, note: null };
  } catch {
    return { calls: null, note: "Счётчик звонков недоступен." };
  }
}

function latestPacket(packets: Record<string, string>): number | null {
  let best: number | null = null;
  for (const value of Object.values(packets)) {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) continue;
    if (best == null || ms > best) best = ms;
  }
  return best;
}

function asStatus(value: string | undefined): PulseStatus {
  if (value === "running" || value === "success" || value === "failed") return value;
  return "never";
}

function asTime(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

async function soft<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}
