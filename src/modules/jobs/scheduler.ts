/**
 * In-process scheduler for regs.poll.
 *
 * The timer loop always starts at process boot (single app replica assumed).
 * Operator control is Settings-only:
 * - app_settings.regsPollEnabled — whether ticks enqueue
 * - app_settings.regsPollIntervalSec — delay between ticks (min 30s)
 *
 * State lives on globalThis so Next.js instrumentation + request handlers share
 * one loop (module-level `let` is duplicated across bundles).
 *
 * Anti-overlap is enforced by the job runtime (no overlapping polls).
 * Bootstrap: instrumentation.ts → evaluateSchedulerBootstrap().
 */

import type { AllowedActionCode } from "@/modules/actions/registry";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { listInboxFiles } from "@/modules/traffic/inbox";
import { requestCdrImportDrain } from "@/modules/traffic/enqueue";
import {
  hasVoipmonitorWork,
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

type SchedulerGlobalState = {
  started: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  runtimeRef: SchedulerJobRuntime | null;
};

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
    const settings = await prisma.appSetting.findUnique({
      where: { id: 1 },
      select: {
        voipmonitorEnabled: true,
        voipmonitorApiUrl: true,
        voipmonitorUser: true,
        voipmonitorPasswordCiphertext: true,
        voipmonitorGuiUrl: true,
      },
    });
    if (
      !settings?.voipmonitorEnabled ||
      !settings.voipmonitorApiUrl?.trim() ||
      !settings.voipmonitorUser?.trim() ||
      !settings.voipmonitorPasswordCiphertext ||
      !settings.voipmonitorGuiUrl?.trim()
    ) {
      return;
    }
    const state = schedulerState();
    if (state.runtimeRef?.isInFlight("voipmonitor.match")) return;
    if (!(await hasVoipmonitorWork())) return;
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

    if (state.runtimeRef.isInFlight("regs.poll")) {
      logger.debug("scheduler.tick.skipped", { reason: "anti-overlap" });
      return;
    }

    const result = await state.runtimeRef.enqueue({
      actionCode: "regs.poll",
      trigger: "schedule",
    });

    logger.info("scheduler.tick.enqueue", {
      accepted: result.accepted,
      reason: result.reason ?? null,
    });
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
      "Ticks enqueue regs.poll only when regsPollEnabled=true.",
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
      "Ticks enqueue regs.poll only when app_settings.regsPollEnabled=true; " +
      "interval from regsPollIntervalSec; anti-overlap enforced.",
  };
}
