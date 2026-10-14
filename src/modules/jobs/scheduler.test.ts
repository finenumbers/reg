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
  decideSmgInboxDrain,
  evaluateSchedulerBootstrap,
  isAutoSchedulerRunning,
  nextExportSyncAfterEnqueue,
  rescheduleAfterSettingsChange,
  scheduledExportAction,
  scheduledRegsAction,
  scheduledSidesRefreshAction,
  sidesRefreshDelaySec,
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

describe("scheduledSidesRefreshAction", () => {
  it("enqueues when idle and enabled", () => {
    expect(
      scheduledSidesRefreshAction({
        enabled: true,
        refreshInFlight: false,
        phonesSyncInFlight: false,
        cdrImportInFlight: false,
      }),
    ).toBe("cdr.sides.refresh");
  });

  it("skips when disabled or a conflicting job is in flight", () => {
    expect(
      scheduledSidesRefreshAction({
        enabled: false,
        refreshInFlight: false,
        phonesSyncInFlight: false,
        cdrImportInFlight: false,
      }),
    ).toBeNull();
    expect(
      scheduledSidesRefreshAction({
        enabled: true,
        refreshInFlight: false,
        phonesSyncInFlight: false,
        cdrImportInFlight: true,
      }),
    ).toBeNull();
  });
});

describe("nextExportSyncAfterEnqueue", () => {
  it("keeps the previous leg when the queue rejects the job", () => {
    expect(nextExportSyncAfterEnqueue(null, "phones.sync", false)).toBeNull();
    expect(nextExportSyncAfterEnqueue("phones.sync", "groups.sync", false)).toBe(
      "phones.sync",
    );
  });

  it("advances only after the queue accepts the job", () => {
    expect(nextExportSyncAfterEnqueue(null, "phones.sync", true)).toBe("phones.sync");
    expect(nextExportSyncAfterEnqueue("phones.sync", "groups.sync", true)).toBe(
      "groups.sync",
    );
  });
});

describe("decideSmgInboxDrain", () => {
  it("stamps an empty scan and does not enqueue", () => {
    expect(decideSmgInboxDrain({ ready: 0, young: 0, settleTimerPending: false })).toBe(
      "stamp-empty",
    );
  });

  it("enqueues when a file is ready", () => {
    expect(decideSmgInboxDrain({ ready: 1, young: 0, settleTimerPending: false })).toBe(
      "enqueue",
    );
    expect(decideSmgInboxDrain({ ready: 1, young: 2, settleTimerPending: true })).toBe(
      "enqueue",
    );
  });

  it("arms one settle timer for a young-only inbox and does not stack another", () => {
    expect(decideSmgInboxDrain({ ready: 0, young: 1, settleTimerPending: false })).toBe(
      "arm-timer",
    );
    expect(decideSmgInboxDrain({ ready: 0, young: 3, settleTimerPending: true })).toBe(
      "keep-timer",
    );
  });
});

describe("sidesRefreshDelaySec", () => {
  it("uses 15s once when there is no snapshot yet", () => {
    expect(
      sidesRefreshDelaySec({
        hasSnapshot: false,
        usedInitialDelay: false,
        intervalSec: 300,
      }),
    ).toBe(15);
    expect(
      sidesRefreshDelaySec({
        hasSnapshot: false,
        usedInitialDelay: true,
        intervalSec: 300,
      }),
    ).toBe(300);
  });
});
