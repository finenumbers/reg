import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    appSetting: {
      findUnique: vi.fn().mockResolvedValue({
        regsPollEnabled: false,
        regsPollIntervalSec: 60,
        exportSyncEnabled: false,
        exportSyncIntervalSec: 300,
      }),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  evaluateSchedulerBootstrap,
  isAutoSchedulerRunning,
  rescheduleAfterSettingsChange,
  scheduledExportAction,
  scheduledRegsAction,
  stopAutoScheduler,
  type SchedulerJobRuntime,
} from "@/modules/jobs/scheduler";

describe("scheduler bootstrap (Settings-only)", () => {
  afterEach(() => {
    stopAutoScheduler();
  });

  it("always starts the loop without env gate", () => {
    const runtime: SchedulerJobRuntime = {
      enqueue: vi.fn().mockResolvedValue({ accepted: true }),
      isInFlight: () => false,
    };
    const result = evaluateSchedulerBootstrap(runtime);
    expect(result.started).toBe(true);
    expect(isAutoSchedulerRunning()).toBe(true);
  });

  it("rescheduleAfterSettingsChange is safe before start", async () => {
    await expect(rescheduleAfterSettingsChange()).resolves.toBeUndefined();
  });
});

describe("scheduledRegsAction", () => {
  it("enqueues regs.poll when nothing is in flight", () => {
    expect(scheduledRegsAction(false)).toBe("regs.poll");
  });

  it("skips regs.poll while it is in flight", () => {
    expect(scheduledRegsAction(true)).toBeNull();
  });
});

describe("scheduledExportAction", () => {
  it("starts with phones.sync", () => {
    expect(
      scheduledExportAction({
        phonesSyncInFlight: false,
        groupsSyncInFlight: false,
        lastExportSync: null,
      }),
    ).toEqual({
      action: "phones.sync",
      nextLastExportSync: "phones.sync",
    });
  });

  it("does not start a second export.py while one is in flight", () => {
    expect(
      scheduledExportAction({
        phonesSyncInFlight: true,
        groupsSyncInFlight: false,
        lastExportSync: "phones.sync",
      }),
    ).toEqual({
      action: null,
      nextLastExportSync: "phones.sync",
    });
  });

  it("alternates phones.sync and groups.sync", () => {
    expect(
      scheduledExportAction({
        phonesSyncInFlight: false,
        groupsSyncInFlight: false,
        lastExportSync: "phones.sync",
      }),
    ).toEqual({
      action: "groups.sync",
      nextLastExportSync: "groups.sync",
    });
    expect(
      scheduledExportAction({
        phonesSyncInFlight: false,
        groupsSyncInFlight: false,
        lastExportSync: "groups.sync",
      }),
    ).toEqual({
      action: "phones.sync",
      nextLastExportSync: "phones.sync",
    });
  });
});
