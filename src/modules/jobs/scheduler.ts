/**
 * In-process scheduler for regs.poll, phones.sync, and groups.sync.
 *
 * The timer loop always starts at process boot (single app replica assumed).
 * Operator control is Settings-only:
 * - app_settings.regsPollEnabled — whether ticks enqueue
 * - app_settings.regsPollIntervalSec — delay between ticks (min 30s)
 *
 * State lives on globalThis so Next.js instrumentation + request handlers share
 * one loop (module-level `let` is duplicated across bundles).
 *
 * Anti-overlap is per action code. phones.sync and groups.sync share export.py,
 * so a tick starts at most one of them.
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

export type ScheduledPollAction = "regs.poll" | "phones.sync" | "groups.sync";
export type ExportSyncAction = "phones.sync" | "groups.sync";

type SchedulerGlobalState = {
  started: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  runtimeRef: SchedulerJobRuntime | null;
  lastExportSync: ExportSyncAction | null;
};

/** Which Settings-gated jobs this tick should enqueue. Pure — used by tests. */
export function scheduledPollActions(input: {
  regsPollInFlight: boolean;
  phonesSyncInFlight: boolean;
  groupsSyncInFlight: boolean;
  lastExportSync: ExportSyncAction | null;
}): { actions: ScheduledPollAction[]; nextLastExportSync: ExportSyncAction | null } {
  const actions: ScheduledPollAction[] = [];
  if (!input.regsPollInFlight) {
    actions.push("regs.poll");
  }

  const exportBusy = input.phonesSyncInFlight || input.groupsSyncInFlight;
  if (exportBusy) {
    return { actions, nextLastExportSync: input.lastExportSync };
  }

  const nextExport: ExportSyncAction =
    input.lastExportSync === "phones.sync" ? "groups.sync" : "phones.sync";
  actions.push(nextExport);
  return { actions, nextLastExportSync: nextExport };
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
      runtimeRef: null,
      lastExportSync: null,
    };
  }
  return g[SCHEDULER_GLOBAL_KEY];
}

export function isAutoSchedulerRunning(): boolean {
  return schedulerState().started;
}

async function readPollSettings(): Promise<{
  enabled: boolean;
  intervalSec: number;
} | null> {
  try {
    const settings = await prisma.appSetting.findUnique({ where: { id: 1 } });
    if (!settings) {
      return { enabled: false, intervalSec: 60 };
    }
    return {
      enabled: settings.regsPollEnabled,
      intervalSec: Math.max(30, settings.regsPollIntervalSec),
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

async function tick(): Promise<void> {
  const state = schedulerState();
  if (!state.runtimeRef) return;

  let intervalSec = 60;
  try {
    await drainPendingInbox();
    await drainVoipmonitorMatch();

    const settings = await readPollSettings();
    if (!settings) {
      return;
    }
    intervalSec = settings.intervalSec;

    if (!settings.enabled) {
      logger.debug("scheduler.tick.skipped", { reason: "regsPollEnabled=false" });
      return;
    }

    const planned = scheduledPollActions({
      regsPollInFlight: state.runtimeRef.isInFlight("regs.poll"),
      phonesSyncInFlight: state.runtimeRef.isInFlight("phones.sync"),
      groupsSyncInFlight: state.runtimeRef.isInFlight("groups.sync"),
      lastExportSync: state.lastExportSync ?? null,
    });
    state.lastExportSync = planned.nextLastExportSync;

    if (planned.actions.length === 0) {
      logger.debug("scheduler.tick.skipped", { reason: "anti-overlap" });
      return;
    }

    for (const actionCode of planned.actions) {
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
  } catch (error) {
    logger.error("scheduler.tick.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    scheduleNext(intervalSec);
  }
}

function scheduleNext(intervalSec: number): void {
  const state = schedulerState();
  if (!state.started) return;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    void tick();
  }, intervalSec * 1000);
  // Allow process to exit in tests / short-lived scripts.
  if (typeof state.timer === "object" && state.timer && "unref" in state.timer) {
    (state.timer as NodeJS.Timeout).unref?.();
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
      "Ticks enqueue regs.poll, phones.sync, and groups.sync when regsPollEnabled=true.",
  });
  // First tick after a short delay so app boot is not blocked by a poll.
  state.timer = setTimeout(() => {
    void tick();
  }, 5_000);
  if (typeof state.timer === "object" && state.timer && "unref" in state.timer) {
    (state.timer as NodeJS.Timeout).unref?.();
  }
}

/**
 * Apply fresh poll settings immediately (clear pending timer, schedule next tick).
 * Safe if the scheduler has not started yet (no-op).
 */
export async function rescheduleAfterSettingsChange(): Promise<void> {
  const state = schedulerState();
  if (!state.started || !state.runtimeRef) {
    return;
  }
  const settings = await readPollSettings();
  const intervalSec = settings?.intervalSec ?? 60;
  logger.info("scheduler.reschedule", {
    enabled: settings?.enabled ?? false,
    intervalSec,
  });
  scheduleNext(intervalSec);
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
}

/**
 * Bootstrap — always start the in-process loop.
 * Operator enablement is Settings regsPollEnabled only.
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
      "Ticks enqueue regs.poll, phones.sync, and groups.sync when " +
      "app_settings.regsPollEnabled=true; interval from regsPollIntervalSec; " +
      "anti-overlap per action; one export.py at a time.",
  };
}
