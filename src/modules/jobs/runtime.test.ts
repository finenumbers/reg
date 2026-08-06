import { beforeEach, describe, expect, it, vi } from "vitest";

const processRegsPoll = vi.fn();
const processPhonesSync = vi.fn();

vi.mock("@/modules/jobs/regs-poll-processor", () => ({
  processRegsPoll: (...args: unknown[]) => processRegsPoll(...args),
}));

vi.mock("@/modules/phones/phones-sync-processor", () => ({
  processPhonesSync: (...args: unknown[]) => processPhonesSync(...args),
}));

vi.mock("@/modules/jobs/scheduler", () => ({
  evaluateSchedulerBootstrap: () => ({
    started: true,
    detail: "mocked",
  }),
  isAutoSchedulerRunning: () => true,
  rescheduleAfterSettingsChange: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { PQueueJobRuntime } from "@/modules/jobs/runtime";

describe("PQueueJobRuntime anti-overlap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    processRegsPoll.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                jobRunId: "job_regs",
                status: "success",
                errorMessage: null,
                phonesParsed: 0,
                linesBad: 0,
                changesCount: 0,
                exitCode: 0,
              }),
            50,
          );
        }),
    );
    processPhonesSync.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                jobRunId: "job_phones",
                status: "success",
                errorMessage: null,
                phonesParsed: 2,
                endpointCount: 1,
                gatewayCount: 1,
                exitCode: 0,
              }),
            50,
          );
        }),
    );
  });

  it("rejects overlapping regs.poll enqueue while in flight", async () => {
    const runtime = new PQueueJobRuntime();

    const firstPromise = runtime.enqueue({
      actionCode: "regs.poll",
      trigger: "manual",
      actorUserId: "u1",
    });
    const secondPromise = runtime.enqueue({
      actionCode: "regs.poll",
      trigger: "manual",
      actorUserId: "u2",
    });

    const [a, b] = await Promise.all([firstPromise, secondPromise]);
    const accepted = [a, b].filter((r) => r.accepted);
    const rejected = [a, b].filter((r) => !r.accepted);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatch(/anti-overlap/i);

    await new Promise((r) => setTimeout(r, 80));
  });

  it("allows phones.sync while regs.poll is in flight", async () => {
    const runtime = new PQueueJobRuntime();

    const regs = await runtime.enqueue({
      actionCode: "regs.poll",
      trigger: "manual",
    });
    const phones = await runtime.enqueue({
      actionCode: "phones.sync",
      trigger: "manual",
    });

    expect(regs.accepted).toBe(true);
    expect(phones.accepted).toBe(true);

    await new Promise((r) => setTimeout(r, 80));
  });
});
