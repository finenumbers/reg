import { beforeEach, describe, expect, it, vi } from "vitest";

const processRegsPoll = vi.fn();
const processPhonesSync = vi.fn();
const processGroupsSync = vi.fn();

vi.mock("@/modules/jobs/regs-poll-processor", () => ({
  processRegsPoll: (...args: unknown[]) => processRegsPoll(...args),
}));

vi.mock("@/modules/phones/phones-sync-processor", () => ({
  processPhonesSync: (...args: unknown[]) => processPhonesSync(...args),
}));

vi.mock("@/modules/groups/groups-sync-processor", () => ({
  processGroupsSync: (...args: unknown[]) => processGroupsSync(...args),
}));

const processCdrImport = vi.fn();
const processCdrSidesRefresh = vi.fn();
const processCdrPurgeMonth = vi.fn();
const requestCdrSidesRefresh = vi.fn();

vi.mock("@/modules/traffic/cdr-import-processor", () => ({
  processCdrImport: (...args: unknown[]) => processCdrImport(...args),
}));

vi.mock("@/modules/traffic/sides-refresh/processor", () => ({
  processCdrSidesRefresh: (...args: unknown[]) =>
    processCdrSidesRefresh(...args),
}));

vi.mock("@/modules/traffic/purge/processor", () => ({
  processCdrPurgeMonth: (...args: unknown[]) => processCdrPurgeMonth(...args),
}));

vi.mock("@/modules/traffic/sides-refresh/enqueue", () => ({
  requestCdrSidesRefresh: (...args: unknown[]) =>
    requestCdrSidesRefresh(...args),
}));

const processVoipmonitorMatch = vi.fn();
const canEnqueueVoipmonitorMatch = vi.fn();
const requestVoipmonitorMatch = vi.fn();

vi.mock("@/modules/voipmonitor/processor", () => ({
  processVoipmonitorMatch: (...args: unknown[]) =>
    processVoipmonitorMatch(...args),
}));

vi.mock("@/modules/voipmonitor/continue", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/voipmonitor/continue")>();
  return {
    ...actual,
    canEnqueueVoipmonitorMatch: (...args: unknown[]) =>
      canEnqueueVoipmonitorMatch(...args),
  };
});

vi.mock("@/modules/voipmonitor/enqueue", () => ({
  requestVoipmonitorMatch: (...args: unknown[]) =>
    requestVoipmonitorMatch(...args),
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
    canEnqueueVoipmonitorMatch.mockResolvedValue(false);
    processVoipmonitorMatch.mockResolvedValue({
      status: "success",
      jobRunId: "vm-default",
      phonesParsed: 0,
      changesCount: 0,
      hoursProcessed: 0,
    });
    processCdrImport.mockResolvedValue({
      status: "success",
      jobRunId: "cdr-1",
      phonesParsed: 1,
      linesBad: 0,
      changesCount: 0,
    });
    processCdrSidesRefresh.mockResolvedValue({
      status: "success",
      jobRunId: "sides-1",
      phonesParsed: 0,
      changesCount: 0,
    });
    processCdrPurgeMonth.mockResolvedValue({
      status: "success",
      jobRunId: "purge-1",
      phonesParsed: 0,
    });
    processGroupsSync.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                jobRunId: "job_groups",
                status: "success",
                errorMessage: null,
                groupCount: 3,
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

  it("allows groups.sync while phones.sync is in flight", async () => {
    const runtime = new PQueueJobRuntime();

    const phones = await runtime.enqueue({
      actionCode: "phones.sync",
      trigger: "manual",
    });
    const groups = await runtime.enqueue({
      actionCode: "groups.sync",
      trigger: "manual",
    });

    expect(phones.accepted).toBe(true);
    expect(groups.accepted).toBe(true);
    expect(processGroupsSync).toHaveBeenCalled();

    await new Promise((r) => setTimeout(r, 80));
  });

  it("chains voipmonitor.match after a successful hour when drain allows", async () => {
    processVoipmonitorMatch.mockResolvedValue({
      status: "success",
      jobRunId: "vm-1",
      phonesParsed: 2,
      changesCount: 2,
      hoursProcessed: 2,
    });
    canEnqueueVoipmonitorMatch.mockResolvedValue(true);

    const runtime = new PQueueJobRuntime();
    await runtime.enqueue({
      actionCode: "voipmonitor.match",
      trigger: "schedule",
    });
    await new Promise((r) => setTimeout(r, 40));

    expect(requestVoipmonitorMatch).toHaveBeenCalledWith("schedule");
  });

  it("does not chain skip or failed voipmonitor.match", async () => {
    canEnqueueVoipmonitorMatch.mockResolvedValue(true);
    processVoipmonitorMatch.mockResolvedValueOnce({
      status: "success",
      jobRunId: "vm-skip",
      phonesParsed: 0,
      changesCount: 0,
      skipped: true,
      hoursProcessed: 0,
    });

    const runtime = new PQueueJobRuntime();
    await runtime.enqueue({
      actionCode: "voipmonitor.match",
      trigger: "schedule",
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(requestVoipmonitorMatch).not.toHaveBeenCalled();

    processVoipmonitorMatch.mockResolvedValueOnce({
      status: "failed",
      jobRunId: "vm-fail",
      phonesParsed: 0,
      changesCount: 0,
      hoursProcessed: 1,
    });
    await runtime.enqueue({
      actionCode: "voipmonitor.match",
      trigger: "schedule",
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(requestVoipmonitorMatch).not.toHaveBeenCalled();
  });

  it("chains cdr.sides.refresh after a successful phones.sync", async () => {
    const runtime = new PQueueJobRuntime();
    await runtime.enqueue({
      actionCode: "phones.sync",
      trigger: "manual",
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(requestCdrSidesRefresh).toHaveBeenCalledWith("schedule");
  });

  it("chains cdr.sides.refresh after a successful cdr.import", async () => {
    const runtime = new PQueueJobRuntime();
    await runtime.enqueue({
      actionCode: "cdr.import",
      trigger: "schedule",
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(requestCdrSidesRefresh).toHaveBeenCalledWith("schedule");
  });

  it("replays cdr.sides.refresh when the catalog moved mid-job", async () => {
    processCdrSidesRefresh.mockResolvedValue({
      status: "success",
      jobRunId: "sides-2",
      phonesParsed: 1,
      changesCount: 2,
      replay: true,
    });
    const runtime = new PQueueJobRuntime();
    await runtime.enqueue({
      actionCode: "cdr.sides.refresh",
      trigger: "schedule",
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(requestCdrSidesRefresh).toHaveBeenCalledWith("schedule");
  });

  it("rejects cdr.purge.month while cdr.import is in flight", async () => {
    processCdrImport.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                status: "success",
                jobRunId: "cdr-slow",
                phonesParsed: 1,
                linesBad: 0,
                changesCount: 0,
              }),
            80,
          );
        }),
    );
    const runtime = new PQueueJobRuntime();
    const importResult = await runtime.enqueue({
      actionCode: "cdr.import",
      trigger: "schedule",
    });
    const purgeResult = await runtime.enqueue({
      actionCode: "cdr.purge.month",
      trigger: "manual",
      month: "2025-01",
    });
    expect(importResult.accepted).toBe(true);
    expect(purgeResult.accepted).toBe(false);
    expect(purgeResult.reason).toMatch(/cdr.import/);
    expect(processCdrPurgeMonth).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 100));
  });
});
