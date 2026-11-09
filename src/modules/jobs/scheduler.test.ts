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
  catalogDelayAfterEnqueue,
  decideSmgInboxDrain,
  evaluateSchedulerBootstrap,
  isAutoSchedulerRunning,
  rescheduleAfterSettingsChange,
  scheduledCatalogTick,
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

  it("clears the VATS timer when the scheduler stops", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("offline"));
    try {
      const runtime: SchedulerJobRuntime = {
        enqueue: vi.fn().mockResolvedValue({ accepted: true }),
        isInFlight: () => false,
      };
      evaluateSchedulerBootstrap(runtime);
      stopAutoScheduler();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      stopAutoScheduler();
      vi.useRealTimers();
    }
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

describe("scheduledCatalogTick", () => {
  const idle = {
    enabled: true,
    phonesSyncInFlight: false,
    groupsSyncInFlight: false,
    regsPollInFlight: false,
  };

  it("reads phones every 60s and groups every 120s", () => {
    expect(scheduledCatalogTick({ ...idle, kind: "phones.sync" })).toEqual({
      action: "phones.sync",
      delaySec: 60,
    });
    expect(scheduledCatalogTick({ ...idle, kind: "groups.sync" })).toEqual({
      action: "groups.sync",
      delaySec: 120,
    });
  });

  it("defers either load while regs.poll or the other catalog load is running", () => {
    expect(
      scheduledCatalogTick({ ...idle, kind: "phones.sync", regsPollInFlight: true }),
    ).toEqual({ action: null, delaySec: 20 });
    expect(
      scheduledCatalogTick({ ...idle, kind: "groups.sync", phonesSyncInFlight: true }),
    ).toEqual({ action: null, delaySec: 20 });
    expect(
      scheduledCatalogTick({ ...idle, kind: "phones.sync", groupsSyncInFlight: true }),
    ).toEqual({ action: null, delaySec: 20 });
  });

  it("keeps the full period while the export loop is off", () => {
    expect(
      scheduledCatalogTick({ ...idle, kind: "phones.sync", enabled: false }),
    ).toEqual({
      action: null,
      delaySec: 60,
    });
    expect(
      scheduledCatalogTick({ ...idle, kind: "groups.sync", enabled: false }),
    ).toEqual({
      action: null,
      delaySec: 120,
    });
  });
});

describe("catalogDelayAfterEnqueue", () => {
  it("retries soon when the queue rejects the load", () => {
    expect(catalogDelayAfterEnqueue(300, false)).toBe(20);
    expect(catalogDelayAfterEnqueue(300, true)).toBe(300);
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
