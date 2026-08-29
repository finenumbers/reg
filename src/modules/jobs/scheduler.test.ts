import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    appSetting: {
      findUnique: vi.fn().mockResolvedValue({
        regsPollEnabled: false,
        regsPollIntervalSec: 60,
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
  scheduledPollActions,
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

describe("scheduledPollActions", () => {
  it("enqueues regs.poll and phones.sync when nothing is in flight", () => {
    expect(
      scheduledPollActions({
        regsPollInFlight: false,
        phonesSyncInFlight: false,
        groupsSyncInFlight: false,
        lastExportSync: null,
      }),
    ).toEqual({
      actions: ["regs.poll", "phones.sync"],
      nextLastExportSync: "phones.sync",
    });
  });

  it("still enqueues export sync while regs.poll is in flight", () => {
    expect(
      scheduledPollActions({
        regsPollInFlight: true,
        phonesSyncInFlight: false,
        groupsSyncInFlight: false,
        lastExportSync: "phones.sync",
      }),
    ).toEqual({
      actions: ["groups.sync"],
      nextLastExportSync: "groups.sync",
    });
  });

  it("does not start a second export.py while one is in flight", () => {
    expect(
      scheduledPollActions({
        regsPollInFlight: false,
        phonesSyncInFlight: true,
        groupsSyncInFlight: false,
        lastExportSync: "phones.sync",
      }),
    ).toEqual({
      actions: ["regs.poll"],
      nextLastExportSync: "phones.sync",
    });
  });

  it("alternates phones.sync and groups.sync", () => {
    expect(
      scheduledPollActions({
        regsPollInFlight: true,
        phonesSyncInFlight: false,
        groupsSyncInFlight: false,
        lastExportSync: "groups.sync",
      }),
    ).toEqual({
      actions: ["phones.sync"],
      nextLastExportSync: "phones.sync",
    });
  });
});
