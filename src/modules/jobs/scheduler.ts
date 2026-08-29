/**
 * In-process scheduler for regs.poll, phones.sync, and groups.sync.
 *
 * Two Settings-gated loops (single app replica assumed):
 * - regs: regsPollEnabled / regsPollIntervalSec → regs.poll
 *   (same loop always drains CDR inbox + VoIPmonitor)
 * - export: exportSyncEnabled / exportSyncIntervalSec → phones.sync
 *   or groups.sync (one export.py at a time, alternating)
 *
 * State lives on globalThis so Next.js instrumentation + request handlers share
 * one loop (module-level `let` is duplicated across bundles).
 *
 * Bootstrap: instrumentation.ts → evaluateSchedulerBootstrap().
 */

import type { AllowedActionCode } from "@/modules/actions/registry";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { listInboxFiles } from "@/modules/traffic/inbox";
import { requestCdrImportDrain } from "@/modules/traffic/enqueue";
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
};

type SchedulerGlobalState = {
  started: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  exportTimer: ReturnType<typeof setTimeout> | null;
  runtimeRef: SchedulerJobRuntime | null;
  lastExportSync: ExportSyncAction | null;
};

const DEFAULT_REGS_INTERVAL_SEC = 60;
const DEFAULT_EXPORT_INTERVAL_SEC = 300;

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
      runtimeRef: null,
      lastExportSync: null,
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
    };
  } catch (error) {
    logger.error("scheduler.settings_read_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function drainVoipmonitorMatch(): Promise<void> {
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

async function drainPendingInbox(): Promise<void> {
  try {
    const pending = await listInboxFiles();
    if (pending.length === 0) return;
    requestCdrImportDrain("schedule");
  } catch (error) {
    logger.warn("scheduler.inbox_scan_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function enqueueScheduled(
  actionCode: AllowedActionCode,
): Promise<void> {
  const state = schedulerState();
  if (!state.runtimeRef) return;
  const result = await state.runtimeRef.enqueue({
    actionCode,
    trigger: "schedule",
  });
  logger.info("scheduler.tick.enqueue", {
    actionCode,
    accepted: result.accepted,
    reason: result.reason ?? null,
  });
}

async function tick(): Promise<void> {
  const state = schedulerState();
  if (!state.runtimeRef) return;

  let intervalSec = DEFAULT_REGS_INTERVAL_SEC;
  try {
    await drainPendingInbox();
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
    state.lastExportSync = planned.nextLastExportSync;
    if (!planned.action) {
      logger.debug("scheduler.export.skipped", { reason: "anti-overlap" });
      return;
    }
    await enqueueScheduled(planned.action);
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

function startSchedulerLoop(runtime: SchedulerJobRuntime): void {
  const state = schedulerState();
  if (state.started) return;
  state.started = true;
  state.runtimeRef = runtime;
  logger.warn("scheduler.started", {
    note:
      "In-process scheduler loop active (single-replica only). " +
      "Duplicate app instances will duplicate polls. " +
      "regs.poll uses regsPollEnabled; phones/groups use exportSyncEnabled.",
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
  const exportIntervalSec =
    settings?.exportIntervalSec ?? DEFAULT_EXPORT_INTERVAL_SEC;
  logger.info("scheduler.reschedule", {
    regsEnabled: settings?.regsEnabled ?? false,
    regsIntervalSec,
    exportEnabled: settings?.exportEnabled ?? false,
    exportIntervalSec,
  });
  scheduleNext(regsIntervalSec);
  scheduleNextExport(exportIntervalSec);
}

/**
 * Stop the auto-scheduler (tests / shutdown). Safe if never started.
 */
export function stopAutoScheduler(): void {
  const state = schedulerState();
  state.started = false;
  state.runtimeRef = null;
  state.lastExportSync = null;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  if (state.exportTimer) {
    clearTimeout(state.exportTimer);
    state.exportTimer = null;
  }
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
      "intervals from Settings; anti-overlap per action.",
  };
}
