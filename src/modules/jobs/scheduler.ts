/**
 * In-process scheduler for regs.poll, phones.sync, and groups.sync.
 *
 * Three Settings-gated loops (single app replica assumed):
 * - regs: regsPollEnabled / regsPollIntervalSec → regs.poll
 *   (same loop always drains CDR inbox, SMG inbox, SMG syslog traces, and VoIPmonitor)
 * - export: exportSyncEnabled / exportSyncIntervalSec → phones.sync
 *   or groups.sync (one export.py at a time, alternating)
 * - sides: cdrSidesRefreshEnabled / interval → cdr.sides.refresh
 *   (also chained after phones.sync / cdr.import)
 * - parking: always, every 60s, reads calls.log only
 *
 * State lives on globalThis so Next.js instrumentation + request handlers share
 * one loop (module-level `let` is duplicated across bundles).
 *
 * Bootstrap: instrumentation.ts → evaluateSchedulerBootstrap().
 */

import type { AllowedActionCode } from "@/modules/actions/registry";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { partitionInboxFiles } from "@/modules/traffic/inbox";
import {
  nextLoadEpisode,
  shouldStampEmptyScan,
  type LoadEpisode,
} from "@/modules/traffic/load-age";
import { isDatabaseVacuumActive } from "@/modules/storage/vacuum/gate";
import { requestCdrImportDrain } from "@/modules/traffic/enqueue";
import { requestSmgImportDrain } from "@/modules/smg/enqueue";
import { drainSmgTraces } from "@/modules/smg-trace/drain";
import { SMG_FILE_SETTLE_MS } from "@/modules/smg/columns";
import { listSmgInboxFiles } from "@/modules/smg/inbox";
import { drainParkingCalls } from "@/modules/antifraud/ingest";
import { PARKING_INTERVAL_MS } from "@/modules/antifraud/constants";
import {
  canEnqueueVoipmonitorMatch,
  requestVoipmonitorMatch,
} from "@/modules/voipmonitor";

/** Minimal runtime surface — avoids circular import with jobs/runtime.ts */
export type SchedulerJobRuntime = {
  enqueue(input: {
    actionCode: AllowedActionCode;
    trigger: "schedule" | "manual" | "test";
    actorUserId?: string;
  }): Promise<{ accepted: boolean; reason?: string }>;
  isInFlight(actionCode: AllowedActionCode): boolean;
};

export type ExportSyncAction = "phones.sync" | "groups.sync";

type ScheduleSettings = {
  regsEnabled: boolean;
  regsIntervalSec: number;
  exportEnabled: boolean;
  exportIntervalSec: number;
  sidesEnabled: boolean;
  sidesIntervalSec: number;
  sidesHasSnapshot: boolean;
};

type SchedulerGlobalState = {
  started: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  exportTimer: ReturnType<typeof setTimeout> | null;
  sidesTimer: ReturnType<typeof setTimeout> | null;
  parkingTimer: ReturnType<typeof setTimeout> | null;
  /** One waiter while an SMG file is still inside the settle window. */
  smgSettleTimer: ReturnType<typeof setTimeout> | null;
  runtimeRef: SchedulerJobRuntime | null;
  lastExportSync: ExportSyncAction | null;
  sidesUsedInitialDelay: boolean;
  /** Set when an inbox scan finds neither a ready nor a young file. */
  lastRtuEmptyScanAt: number | null;
  lastSmgEmptyScanAt: number | null;
  /** Yellow file that ended a red episode. Lost on process restart. */
  rtuEpisode: LoadEpisode | null;
  smgEpisode: LoadEpisode | null;
};

const DEFAULT_REGS_INTERVAL_SEC = 60;
const DEFAULT_EXPORT_INTERVAL_SEC = 300;
const DEFAULT_SIDES_REFRESH_INTERVAL_SEC = 300;
const FIRST_SIDES_REFRESH_DELAY_SEC = 15;

/** Next regs.poll, or null when that job is already running. Pure — used by tests. */
export function scheduledRegsAction(regsPollInFlight: boolean): "regs.poll" | null {
  return regsPollInFlight ? null : "regs.poll";
}

/** Next export.py job. Pure — used by tests. */
export function scheduledExportAction(input: {
  phonesSyncInFlight: boolean;
  groupsSyncInFlight: boolean;
  lastExportSync: ExportSyncAction | null;
}): { action: ExportSyncAction | null; nextLastExportSync: ExportSyncAction | null } {
  if (input.phonesSyncInFlight || input.groupsSyncInFlight) {
    return { action: null, nextLastExportSync: input.lastExportSync };
  }
  const nextExport: ExportSyncAction =
    input.lastExportSync === "phones.sync" ? "groups.sync" : "phones.sync";
  return { action: nextExport, nextLastExportSync: nextExport };
}

/**
 * Advance the export alternation only after the queue accepts the job.
 * A rejected enqueue keeps the previous leg so the next tick retries it.
 */
export function nextExportSyncAfterEnqueue(
  lastExportSync: ExportSyncAction | null,
  plannedNext: ExportSyncAction | null,
  accepted: boolean,
): ExportSyncAction | null {
  if (!accepted || plannedNext == null) return lastExportSync;
  return plannedNext;
}

export type SmgInboxDrainAction = "stamp-empty" | "enqueue" | "arm-timer" | "keep-timer";

/**
 * Ready files import now. A young-only inbox waits on one settle timer and
 * does not enqueue smg.import until a file is ready.
 */
export function decideSmgInboxDrain(input: {
  ready: number;
  young: number;
  settleTimerPending: boolean;
}): SmgInboxDrainAction {
  if (shouldStampEmptyScan(input.ready, input.young)) return "stamp-empty";
  if (input.ready > 0) return "enqueue";
  if (input.settleTimerPending) return "keep-timer";
  return "arm-timer";
}

/** Next cdr.sides.refresh. Pure — used by tests. */
export function scheduledSidesRefreshAction(input: {
  enabled: boolean;
  refreshInFlight: boolean;
  phonesSyncInFlight: boolean;
  cdrImportInFlight: boolean;
}): "cdr.sides.refresh" | null {
  if (!input.enabled) return null;
  if (input.refreshInFlight || input.phonesSyncInFlight || input.cdrImportInFlight) {
    return null;
  }
  return "cdr.sides.refresh";
}

export function sidesRefreshDelaySec(input: {
  hasSnapshot: boolean;
  usedInitialDelay: boolean;
  intervalSec: number;
}): number {
  if (!input.hasSnapshot && !input.usedInitialDelay) {
    return FIRST_SIDES_REFRESH_DELAY_SEC;
  }
  return Math.max(30, input.intervalSec);
}

const SCHEDULER_GLOBAL_KEY = "__reg_scheduler_state__";

function schedulerState(): SchedulerGlobalState {
  const g = globalThis as typeof globalThis & {
    [SCHEDULER_GLOBAL_KEY]?: SchedulerGlobalState;
  };
  if (!g[SCHEDULER_GLOBAL_KEY]) {
    g[SCHEDULER_GLOBAL_KEY] = {
      started: false,
      timer: null,
      exportTimer: null,
      sidesTimer: null,
      parkingTimer: null,
      smgSettleTimer: null,
      runtimeRef: null,
      lastExportSync: null,
      sidesUsedInitialDelay: false,
      lastRtuEmptyScanAt: null,
      lastSmgEmptyScanAt: null,
      rtuEpisode: null,
      smgEpisode: null,
    };
  }
  return g[SCHEDULER_GLOBAL_KEY];
}

export function isAutoSchedulerRunning(): boolean {
  return schedulerState().started;
}

function clampInterval(raw: number | undefined, fallback: number): number {
  return Math.max(30, raw ?? fallback);
}

async function readScheduleSettings(): Promise<ScheduleSettings | null> {
  try {
    const settings = await prisma.appSetting.findUnique({ where: { id: 1 } });
    if (!settings) {
      return {
        regsEnabled: false,
        regsIntervalSec: DEFAULT_REGS_INTERVAL_SEC,
        exportEnabled: false,
        exportIntervalSec: DEFAULT_EXPORT_INTERVAL_SEC,
        sidesEnabled: true,
        sidesIntervalSec: DEFAULT_SIDES_REFRESH_INTERVAL_SEC,
        sidesHasSnapshot: false,
      };
    }
    return {
      regsEnabled: settings.regsPollEnabled,
      regsIntervalSec: clampInterval(
        settings.regsPollIntervalSec,
        DEFAULT_REGS_INTERVAL_SEC,
      ),
      exportEnabled: settings.exportSyncEnabled,
      exportIntervalSec: clampInterval(
        settings.exportSyncIntervalSec,
        DEFAULT_EXPORT_INTERVAL_SEC,
      ),
      sidesEnabled: settings.cdrSidesRefreshEnabled,
      sidesIntervalSec: clampInterval(
        settings.cdrSidesRefreshIntervalSec,
        DEFAULT_SIDES_REFRESH_INTERVAL_SEC,
      ),
      sidesHasSnapshot: settings.cdrSidesRefreshMap != null,
    };
  } catch (error) {
    logger.error("scheduler.settings_read_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function drainVoipmonitorMatch(): Promise<void> {
  if (isDatabaseVacuumActive()) return;
  try {
    const state = schedulerState();
    const allowed = await canEnqueueVoipmonitorMatch(
      () => state.runtimeRef?.isInFlight("voipmonitor.match") ?? false,
    );
    if (!allowed) return;
    requestVoipmonitorMatch("schedule");
  } catch (error) {
    logger.warn("scheduler.voipmonitor_scan_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function lastRtuEmptyScanAt(): number | null {
  return schedulerState().lastRtuEmptyScanAt;
}

export function lastSmgEmptyScanAt(): number | null {
  return schedulerState().lastSmgEmptyScanAt;
}

export type LoadCounterSide = "rtu" | "smg";

/** Empty-file time that ended red, if this process saw that gap. */
export function loadStreakBreakAt(side: LoadCounterSide): number | null {
  const episode =
    side === "rtu" ? schedulerState().rtuEpisode : schedulerState().smgEpisode;
  if (!episode || episode.hadCalls || !episode.brokeRed) return null;
  return episode.anchor;
}

/** Remember a file pass. A later empty scan does not erase a yellow break. */
export function noteLoadFilePass(
  side: LoadCounterSide,
  pass: { at: number; hadCalls: boolean },
): void {
  const state = schedulerState();
  const episode = side === "rtu" ? state.rtuEpisode : state.smgEpisode;
  const scanAt = side === "rtu" ? state.lastRtuEmptyScanAt : state.lastSmgEmptyScanAt;
  const next = nextLoadEpisode(episode, scanAt, pass);
  if (side === "rtu") state.rtuEpisode = next;
  else state.smgEpisode = next;
}

async function drainPendingInbox(): Promise<void> {
  try {
    const { ready, young } = await partitionInboxFiles();
    if (shouldStampEmptyScan(ready.length, young.length)) {
      schedulerState().lastRtuEmptyScanAt = Date.now();
      return;
    }
    requestCdrImportDrain("schedule");
  } catch (error) {
    logger.warn("scheduler.inbox_scan_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function clearSmgSettleTimer(): void {
  const state = schedulerState();
  if (!state.smgSettleTimer) return;
  clearTimeout(state.smgSettleTimer);
  state.smgSettleTimer = null;
}

function armSmgSettleTimer(): void {
  const state = schedulerState();
  if (state.smgSettleTimer) return;
  state.smgSettleTimer = armTimer(null, SMG_FILE_SETTLE_MS, () => {
    schedulerState().smgSettleTimer = null;
    void drainPendingSmgInbox();
  });
}

async function drainPendingSmgInbox(): Promise<void> {
  if (isDatabaseVacuumActive()) return;
  try {
    const { ready, young } = await listSmgInboxFiles();
    const state = schedulerState();
    const action = decideSmgInboxDrain({
      ready: ready.length,
      young: young.length,
      settleTimerPending: state.smgSettleTimer != null,
    });
    if (action === "stamp-empty") {
      clearSmgSettleTimer();
      state.lastSmgEmptyScanAt = Date.now();
      return;
    }
    if (action === "enqueue") {
      clearSmgSettleTimer();
      requestSmgImportDrain("schedule");
      return;
    }
    if (action === "arm-timer") armSmgSettleTimer();
  } catch (error) {
    logger.warn("scheduler.smg_inbox_scan_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function enqueueScheduled(
  actionCode: AllowedActionCode,
): Promise<{ accepted: boolean }> {
  const state = schedulerState();
  if (!state.runtimeRef) return { accepted: false };
  const result = await state.runtimeRef.enqueue({
    actionCode,
    trigger: "schedule",
  });
  logger.info("scheduler.tick.enqueue", {
    actionCode,
    accepted: result.accepted,
    reason: result.reason ?? null,
  });
  return result;
}

async function tick(): Promise<void> {
  const state = schedulerState();
  if (!state.runtimeRef) return;

  let intervalSec = DEFAULT_REGS_INTERVAL_SEC;
  try {
    await drainPendingInbox();
    await drainPendingSmgInbox();
    void drainSmgTraces();
    await drainVoipmonitorMatch();

    const settings = await readScheduleSettings();
    if (!settings) {
      return;
    }
    intervalSec = settings.regsIntervalSec;

    if (!settings.regsEnabled) {
      logger.debug("scheduler.tick.skipped", { reason: "regsPollEnabled=false" });
      return;
    }

    const action = scheduledRegsAction(state.runtimeRef.isInFlight("regs.poll"));
    if (!action) {
      logger.debug("scheduler.tick.skipped", { reason: "anti-overlap" });
      return;
    }
    await enqueueScheduled(action);
  } catch (error) {
    logger.error("scheduler.tick.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    scheduleNext(intervalSec);
  }
}

async function tickExport(): Promise<void> {
  const state = schedulerState();
  if (!state.runtimeRef) return;

  let intervalSec = DEFAULT_EXPORT_INTERVAL_SEC;
  try {
    const settings = await readScheduleSettings();
    if (!settings) {
      return;
    }
    intervalSec = settings.exportIntervalSec;

    if (!settings.exportEnabled) {
      logger.debug("scheduler.export.skipped", {
        reason: "exportSyncEnabled=false",
      });
      return;
    }

    const planned = scheduledExportAction({
      phonesSyncInFlight: state.runtimeRef.isInFlight("phones.sync"),
      groupsSyncInFlight: state.runtimeRef.isInFlight("groups.sync"),
      lastExportSync: state.lastExportSync ?? null,
    });
    if (!planned.action) {
      logger.debug("scheduler.export.skipped", { reason: "anti-overlap" });
      return;
    }
    const queued = await enqueueScheduled(planned.action);
    state.lastExportSync = nextExportSyncAfterEnqueue(
      state.lastExportSync,
      planned.nextLastExportSync,
      queued.accepted,
    );
  } catch (error) {
    logger.error("scheduler.export.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    scheduleNextExport(intervalSec);
  }
}

function armTimer(
  current: ReturnType<typeof setTimeout> | null,
  delayMs: number,
  fn: () => void,
): ReturnType<typeof setTimeout> {
  if (current) clearTimeout(current);
  const timer = setTimeout(fn, delayMs);
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as NodeJS.Timeout).unref?.();
  }
  return timer;
}

function scheduleNext(intervalSec: number): void {
  const state = schedulerState();
  if (!state.started) return;
  state.timer = armTimer(state.timer, intervalSec * 1000, () => {
    void tick();
  });
}

function scheduleNextExport(intervalSec: number): void {
  const state = schedulerState();
  if (!state.started) return;
  state.exportTimer = armTimer(state.exportTimer, intervalSec * 1000, () => {
    void tickExport();
  });
}

function scheduleNextSides(intervalSec: number): void {
  const state = schedulerState();
  if (!state.started) return;
  state.sidesTimer = armTimer(state.sidesTimer, intervalSec * 1000, () => {
    void tickSides();
  });
}

function scheduleNextParking(delayMs = PARKING_INTERVAL_MS): void {
  const state = schedulerState();
  if (!state.started) return;
  state.parkingTimer = armTimer(state.parkingTimer, delayMs, () => {
    void drainParkingCalls().finally(() => {
      scheduleNextParking();
    });
  });
}

async function tickSides(): Promise<void> {
  const state = schedulerState();
  if (!state.runtimeRef) return;

  let intervalSec = DEFAULT_SIDES_REFRESH_INTERVAL_SEC;
  try {
    const settings = await readScheduleSettings();
    if (!settings) {
      return;
    }
    intervalSec = sidesRefreshDelaySec({
      hasSnapshot: settings.sidesHasSnapshot,
      usedInitialDelay: state.sidesUsedInitialDelay,
      intervalSec: settings.sidesIntervalSec,
    });
    if (!settings.sidesHasSnapshot && !state.sidesUsedInitialDelay) {
      state.sidesUsedInitialDelay = true;
    }

    if (!settings.sidesEnabled) {
      logger.debug("scheduler.sides.skipped", {
        reason: "cdrSidesRefreshEnabled=false",
      });
      return;
    }

    const action = scheduledSidesRefreshAction({
      enabled: true,
      refreshInFlight: state.runtimeRef.isInFlight("cdr.sides.refresh"),
      phonesSyncInFlight: state.runtimeRef.isInFlight("phones.sync"),
      cdrImportInFlight: state.runtimeRef.isInFlight("cdr.import"),
    });
    if (!action) {
      logger.debug("scheduler.sides.skipped", { reason: "anti-overlap" });
      return;
    }
    await enqueueScheduled(action);
  } catch (error) {
    logger.error("scheduler.sides.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    const latest = await readScheduleSettings();
    const next = latest
      ? sidesRefreshDelaySec({
          hasSnapshot: latest.sidesHasSnapshot,
          usedInitialDelay: state.sidesUsedInitialDelay,
          intervalSec: latest.sidesIntervalSec,
        })
      : intervalSec;
    scheduleNextSides(next);
  }
}

function startSchedulerLoop(runtime: SchedulerJobRuntime): void {
  const state = schedulerState();
  if (state.started) return;
  state.started = true;
  state.runtimeRef = runtime;
  logger.warn("scheduler.started", {
    note:
      "In-process scheduler loop active (single-replica only). " +
      "Duplicate app instances will duplicate polls. " +
      "regs.poll uses regsPollEnabled; phones/groups use exportSyncEnabled; " +
      "cdr.sides.refresh uses cdrSidesRefreshEnabled.",
  });
  // First regs/housekeeping tick after a short delay so boot is not blocked.
  state.timer = armTimer(null, 5_000, () => {
    void tick();
  });
  // First export tick waits a full export interval so it does not share boot
  // with regs.poll.
  void (async () => {
    const settings = await readScheduleSettings();
    const intervalSec = settings?.exportIntervalSec ?? DEFAULT_EXPORT_INTERVAL_SEC;
    scheduleNextExport(intervalSec);
    const sidesDelay = settings
      ? sidesRefreshDelaySec({
          hasSnapshot: settings.sidesHasSnapshot,
          usedInitialDelay: false,
          intervalSec: settings.sidesIntervalSec,
        })
      : FIRST_SIDES_REFRESH_DELAY_SEC;
    scheduleNextSides(sidesDelay);
    scheduleNextParking(8_000);
  })();
}

/**
 * Apply fresh poll settings immediately (clear pending timers, schedule next ticks).
 * Safe if the scheduler has not started yet (no-op).
 */
export async function rescheduleAfterSettingsChange(): Promise<void> {
  const state = schedulerState();
  if (!state.started || !state.runtimeRef) {
    return;
  }
  const settings = await readScheduleSettings();
  const regsIntervalSec = settings?.regsIntervalSec ?? DEFAULT_REGS_INTERVAL_SEC;
  const exportIntervalSec = settings?.exportIntervalSec ?? DEFAULT_EXPORT_INTERVAL_SEC;
  const sidesDelay = settings
    ? sidesRefreshDelaySec({
        hasSnapshot: settings.sidesHasSnapshot,
        usedInitialDelay: state.sidesUsedInitialDelay,
        intervalSec: settings.sidesIntervalSec,
      })
    : DEFAULT_SIDES_REFRESH_INTERVAL_SEC;
  logger.info("scheduler.reschedule", {
    regsEnabled: settings?.regsEnabled ?? false,
    regsIntervalSec,
    exportEnabled: settings?.exportEnabled ?? false,
    exportIntervalSec,
    sidesEnabled: settings?.sidesEnabled ?? false,
    sidesIntervalSec: sidesDelay,
  });
  scheduleNext(regsIntervalSec);
  scheduleNextExport(exportIntervalSec);
  scheduleNextSides(sidesDelay);
}

/**
 * Stop the auto-scheduler (tests / shutdown). Safe if never started.
 */
export function stopAutoScheduler(): void {
  const state = schedulerState();
  state.started = false;
  state.runtimeRef = null;
  state.lastExportSync = null;
  state.sidesUsedInitialDelay = false;
  state.lastRtuEmptyScanAt = null;
  state.lastSmgEmptyScanAt = null;
  state.rtuEpisode = null;
  state.smgEpisode = null;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  if (state.exportTimer) {
    clearTimeout(state.exportTimer);
    state.exportTimer = null;
  }
  if (state.sidesTimer) {
    clearTimeout(state.sidesTimer);
    state.sidesTimer = null;
  }
  if (state.parkingTimer) {
    clearTimeout(state.parkingTimer);
    state.parkingTimer = null;
  }
  clearSmgSettleTimer();
}

/**
 * Bootstrap — always start the in-process loops.
 * Operator enablement is Settings-only (regs and export independently).
 */
export function evaluateSchedulerBootstrap(runtime: SchedulerJobRuntime): {
  started: boolean;
  detail: string;
} {
  startSchedulerLoop(runtime);
  return {
    started: true,
    detail:
      "Auto-scheduler loop started (single-replica only). " +
      "regs.poll when regsPollEnabled=true; phones.sync/groups.sync when " +
      "exportSyncEnabled=true (one export.py at a time); " +
      "cdr.sides.refresh when cdrSidesRefreshEnabled=true; " +
      "intervals from Settings; anti-overlap per action.",
  };
}
