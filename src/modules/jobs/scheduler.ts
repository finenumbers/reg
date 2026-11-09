/**
 * In-process scheduler for regs.poll, phones.sync, groups.sync, and VATS.
 *
 * Loops (single app replica assumed):
 * - regs: regsPollEnabled → regs.poll every REGS_POLL_INTERVAL_SEC
 *   (same loop always drains CDR inbox, SMG inbox, SMG syslog traces, and VoIPmonitor)
 * - export: exportSyncEnabled → phones.sync every PHONES_SYNC_INTERVAL_SEC,
 *   groups.sync every GROUPS_SYNC_INTERVAL_SEC. Neither catalog load starts
 *   while the other is running or while regs.poll is running.
 *   regs.poll does not wait for either catalog load.
 * - sides: cdrSidesRefreshEnabled / interval → cdr.sides.refresh
 *   (also chained after phones.sync / cdr.import)
 * - parking: always, every 60s, reads calls.log only
 * - vats: always, first pass after 5s, then 120s after each pass finishes.
 *   One Boss request at a time. Settings save restarts the pass. Not a job-queue action.
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
import { nextVatsDelayMs, VATS_FIRST_DELAY_MS } from "@/modules/vats/cadence";
import {
  consumeVatsRestart,
  isVatsCycleRunning,
  registerVatsKick,
  setVatsCycleRunning,
} from "@/modules/vats/control";
import { runScheduledVatsCycle } from "@/modules/vats/service";
import {
  catalogPeriodSec,
  clampScheduleInterval,
  EXPORT_DEFER_SEC,
  FIRST_GROUPS_DELAY_SEC,
  FIRST_PHONES_DELAY_SEC,
  GROUPS_RESCHEDULE_DELAY_SEC,
  GROUPS_SYNC_INTERVAL_SEC,
  PHONES_RESCHEDULE_DELAY_SEC,
  PHONES_SYNC_INTERVAL_SEC,
  REGS_POLL_INTERVAL_SEC,
  REGS_RESCHEDULE_DELAY_SEC,
} from "@/modules/jobs/export-cadence";

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

export type CatalogTick = {
  action: ExportSyncAction | null;
  delaySec: number;
};

type ScheduleSettings = {
  regsEnabled: boolean;
  exportEnabled: boolean;
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
  groupsTimer: ReturnType<typeof setTimeout> | null;
  sidesUsedInitialDelay: boolean;
  /** Set when an inbox scan finds neither a ready nor a young file. */
  lastRtuEmptyScanAt: number | null;
  lastSmgEmptyScanAt: number | null;
  /** Yellow file that ended a red episode. Lost on process restart. */
  rtuEpisode: LoadEpisode | null;
  smgEpisode: LoadEpisode | null;
  vatsTimer: ReturnType<typeof setTimeout> | null;
};

const DEFAULT_SIDES_REFRESH_INTERVAL_SEC = 300;
const FIRST_SIDES_REFRESH_DELAY_SEC = 15;

/** Next regs.poll, or null when that job is already running. Pure — used by tests. */
export function scheduledRegsAction(regsPollInFlight: boolean): "regs.poll" | null {
  return regsPollInFlight ? null : "regs.poll";
}

/**
 * Next phones.sync or groups.sync. The two loads do not overlap each other
 * and do not start while regs.poll is running. A blocked tick retries shortly.
 * A rejected enqueue uses the same short delay. regs.poll is not delayed here.
 */
export function scheduledCatalogTick(input: {
  kind: ExportSyncAction;
  enabled: boolean;
  phonesSyncInFlight: boolean;
  groupsSyncInFlight: boolean;
  regsPollInFlight: boolean;
}): CatalogTick {
  const period = catalogPeriodSec(input.kind);
  if (!input.enabled) return { action: null, delaySec: period };
  const blocked =
    input.phonesSyncInFlight || input.groupsSyncInFlight || input.regsPollInFlight;
  if (blocked) return { action: null, delaySec: EXPORT_DEFER_SEC };
  return { action: input.kind, delaySec: period };
}

/** Short retry when the queue refuses a catalog load that the tick already chose. */
export function catalogDelayAfterEnqueue(delaySec: number, accepted: boolean): number {
  return accepted ? delaySec : EXPORT_DEFER_SEC;
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
      groupsTimer: null,
      sidesUsedInitialDelay: false,
      lastRtuEmptyScanAt: null,
      lastSmgEmptyScanAt: null,
      rtuEpisode: null,
      smgEpisode: null,
      vatsTimer: null,
    };
  }
  return g[SCHEDULER_GLOBAL_KEY];
}

export function isAutoSchedulerRunning(): boolean {
  return schedulerState().started;
}

function clampInterval(raw: number | undefined, fallback: number): number {
  return clampScheduleInterval(raw, fallback);
}

async function readScheduleSettings(): Promise<ScheduleSettings | null> {
  try {
    const settings = await prisma.appSetting.findUnique({ where: { id: 1 } });
    if (!settings) {
      return {
        regsEnabled: false,
        exportEnabled: false,
        sidesEnabled: true,
        sidesIntervalSec: DEFAULT_SIDES_REFRESH_INTERVAL_SEC,
        sidesHasSnapshot: false,
      };
    }
    return {
      regsEnabled: settings.regsPollEnabled,
      exportEnabled: settings.exportSyncEnabled,
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

  try {
    await drainPendingInbox();
    await drainPendingSmgInbox();
    void drainSmgTraces();
    await drainVoipmonitorMatch();

    const settings = await readScheduleSettings();
    if (!settings) {
      return;
    }

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
    scheduleNext(REGS_POLL_INTERVAL_SEC);
  }
}

async function tickCatalog(kind: ExportSyncAction): Promise<number> {
  const state = schedulerState();
  const fallback = catalogPeriodSec(kind);
  if (!state.runtimeRef) return fallback;

  let delaySec = fallback;
  try {
    const settings = await readScheduleSettings();
    if (!settings) return delaySec;
    const decision = scheduledCatalogTick({
      kind,
      enabled: settings.exportEnabled,
      phonesSyncInFlight: state.runtimeRef.isInFlight("phones.sync"),
      groupsSyncInFlight: state.runtimeRef.isInFlight("groups.sync"),
      regsPollInFlight: state.runtimeRef.isInFlight("regs.poll"),
    });
    delaySec = decision.delaySec;
    const logName =
      kind === "phones.sync" ? "scheduler.phones.skipped" : "scheduler.groups.skipped";
    if (!settings.exportEnabled) {
      logger.debug(logName, { reason: "exportSyncEnabled=false" });
      return delaySec;
    }
    if (!decision.action) {
      logger.debug(logName, { reason: "anti-overlap" });
      return delaySec;
    }
    const queued = await enqueueScheduled(decision.action);
    delaySec = catalogDelayAfterEnqueue(decision.delaySec, queued.accepted);
  } catch (error) {
    logger.error(
      kind === "phones.sync" ? "scheduler.phones.failed" : "scheduler.groups.failed",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
  return delaySec;
}

async function tickExport(): Promise<void> {
  const state = schedulerState();
  if (!state.runtimeRef) return;
  const delaySec = await tickCatalog("phones.sync");
  if (schedulerState().started) scheduleNextExport(delaySec);
}

async function tickGroups(): Promise<void> {
  const state = schedulerState();
  if (!state.runtimeRef) return;
  const delaySec = await tickCatalog("groups.sync");
  if (schedulerState().started) scheduleNextGroups(delaySec);
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

function scheduleNextGroups(intervalSec: number): void {
  const state = schedulerState();
  if (!state.started) return;
  state.groupsTimer = armTimer(state.groupsTimer, intervalSec * 1000, () => {
    void tickGroups();
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

function scheduleVats(delayMs: number): void {
  const state = schedulerState();
  if (!state.started) return;
  if (state.vatsTimer) clearTimeout(state.vatsTimer);
  state.vatsTimer = setTimeout(() => {
    state.vatsTimer = null;
    if (!schedulerState().started) return;
    void runVatsGuarded();
  }, delayMs);
}

async function runVatsGuarded(): Promise<void> {
  if (isVatsCycleRunning()) return;
  setVatsCycleRunning(true);
  try {
    await runScheduledVatsCycle();
  } catch {
    logger.error("vats.cycle.failed");
  } finally {
    setVatsCycleRunning(false);
    if (!schedulerState().started) return;
    scheduleVats(nextVatsDelayMs(consumeVatsRestart()));
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
      "regs.poll uses regsPollEnabled; phones.sync and groups.sync use exportSyncEnabled; " +
      "cdr.sides.refresh uses cdrSidesRefreshEnabled. " +
      "VATS reads every 120s after the previous pass, one platform request at a time.",
  });
  // First regs/housekeeping tick after a short delay so boot is not blocked.
  state.timer = armTimer(null, 5_000, () => {
    void tick();
  });
  // Phones and groups start after regs.poll has had a chance to begin.
  // A running registration poll defers them by EXPORT_DEFER_SEC.
  scheduleNextExport(FIRST_PHONES_DELAY_SEC);
  scheduleNextGroups(FIRST_GROUPS_DELAY_SEC);
  void (async () => {
    const settings = await readScheduleSettings();
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
  registerVatsKick(() => scheduleVats(0));
  scheduleVats(VATS_FIRST_DELAY_MS);
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
  const sidesDelay = settings
    ? sidesRefreshDelaySec({
        hasSnapshot: settings.sidesHasSnapshot,
        usedInitialDelay: state.sidesUsedInitialDelay,
        intervalSec: settings.sidesIntervalSec,
      })
    : DEFAULT_SIDES_REFRESH_INTERVAL_SEC;
  logger.info("scheduler.reschedule", {
    regsEnabled: settings?.regsEnabled ?? false,
    regsIntervalSec: REGS_POLL_INTERVAL_SEC,
    regsDelaySec: REGS_RESCHEDULE_DELAY_SEC,
    exportEnabled: settings?.exportEnabled ?? false,
    phonesIntervalSec: PHONES_SYNC_INTERVAL_SEC,
    phonesDelaySec: PHONES_RESCHEDULE_DELAY_SEC,
    groupsIntervalSec: GROUPS_SYNC_INTERVAL_SEC,
    groupsDelaySec: GROUPS_RESCHEDULE_DELAY_SEC,
    sidesEnabled: settings?.sidesEnabled ?? false,
    sidesIntervalSec: sidesDelay,
  });
  scheduleNext(REGS_RESCHEDULE_DELAY_SEC);
  scheduleNextExport(PHONES_RESCHEDULE_DELAY_SEC);
  scheduleNextGroups(GROUPS_RESCHEDULE_DELAY_SEC);
  scheduleNextSides(sidesDelay);
}

/**
 * Stop the auto-scheduler (tests / shutdown). Safe if never started.
 */
export function stopAutoScheduler(): void {
  const state = schedulerState();
  state.started = false;
  state.runtimeRef = null;
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
  if (state.groupsTimer) {
    clearTimeout(state.groupsTimer);
    state.groupsTimer = null;
  }
  if (state.sidesTimer) {
    clearTimeout(state.sidesTimer);
    state.sidesTimer = null;
  }
  if (state.parkingTimer) {
    clearTimeout(state.parkingTimer);
    state.parkingTimer = null;
  }
  if (state.vatsTimer) {
    clearTimeout(state.vatsTimer);
    state.vatsTimer = null;
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
      "regs.poll every 30s when regsPollEnabled=true; " +
      "phones.sync every 60s and groups.sync every 120s when exportSyncEnabled=true " +
      "(neither catalog load starts while the other or regs.poll is running); " +
      "cdr.sides.refresh when cdrSidesRefreshEnabled=true; " +
      "sides interval from Settings; anti-overlap per action; " +
      "VATS every 120s.",
  };
}
