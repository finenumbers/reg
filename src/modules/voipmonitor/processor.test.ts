import { beforeEach, describe, expect, it, vi } from "vitest";

const loadVoipmonitorRuntime = vi.fn();
const matchBucket = vi.fn();
const jobRunCreate = vi.fn();
const jobRunUpdate = vi.fn();
const jobRunUpdateMany = vi.fn();
const queryRaw = vi.fn();
const executeRaw = vi.fn();
const findMany = vi.fn();
const findLinks = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
    jobRun: {
      create: (...args: unknown[]) => jobRunCreate(...args),
      update: (...args: unknown[]) => jobRunUpdate(...args),
      updateMany: (...args: unknown[]) => jobRunUpdateMany(...args),
    },
    cdrRecord: {
      findMany: (...args: unknown[]) => findMany(...args),
    },
    cdrVoipmonitorLink: {
      findMany: (...args: unknown[]) => findLinks(...args),
    },
  },
}));

vi.mock("@/modules/voipmonitor/credentials", () => ({
  loadVoipmonitorRuntime: (...args: unknown[]) => loadVoipmonitorRuntime(...args),
}));

vi.mock("@/modules/voipmonitor/match", () => ({
  matchBucket: (...args: unknown[]) => matchBucket(...args),
}));

vi.mock("@/modules/audit", () => ({
  AUDIT_ACTIONS: {
    VOIPMONITOR_MATCH_MANUAL: "voipmonitor.match_manual",
    VOIPMONITOR_MATCH_START: "voipmonitor.match_start",
    VOIPMONITOR_MATCH_FINISH: "voipmonitor.match_finish",
  },
  auditService: { append: vi.fn() },
}));

vi.mock("@/modules/jobs/finalize", () => ({
  failJobRunIfStillRunning: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { processVoipmonitorMatch } from "@/modules/voipmonitor/processor";

function satelRow(id: string, cdrAt: Date) {
  return {
    id,
    cdrId: `cdr-${id}`,
    cdrAt,
    billAni: "7900",
    billDnis: "7499",
    inAni: "",
    inDnis: "",
    outAni: "",
    outDnis: "",
    elapsedTime: "24383",
    connectTime: "",
    disconnectTime: "",
    remoteSrcSigAddress: "",
    remoteDstSigAddress: "",
    localSrcSigAddress: "",
    localDstSigAddress: "",
    outLegCallId: `call-${id}`,
    srcOutLegCallId: "",
    inLegCallId: "",
    srcInLegCallId: "",
    srcInLegConfId: "",
    confId: "",
  };
}

function matchHit() {
  return {
    status: "matched_exact",
    method: "callid",
    score: 100,
    vm: { cdrId: "vm1", callId: "c1" },
    cardUrl: "https://vm/example",
    legs: {},
    evidenceJson: "",
    matchedAt: new Date(),
    missReason: "",
  };
}

describe("processVoipmonitorMatch interleave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobRunCreate.mockResolvedValue({ id: "job-1" });
    jobRunUpdate.mockResolvedValue({});
    executeRaw.mockResolvedValue(1);
    findLinks.mockResolvedValue([]);
    loadVoipmonitorRuntime.mockResolvedValue({
      enabled: true,
      ready: true,
      apiUrl: "https://vm/php/api.php",
      user: "u",
      password: "p",
      guiUrl: "https://vm",
    });
  });

  it("processes live then archive when both lanes have work", async () => {
    queryRaw
      .mockResolvedValueOnce([{ hour: new Date("2026-08-29T10:00:00.000Z") }])
      .mockResolvedValueOnce([{ hour: new Date("2026-08-20T10:00:00.000Z") }])
      .mockResolvedValue([]);
    findMany
      .mockResolvedValueOnce([satelRow("live1", new Date("2026-08-29T10:15:00.000Z"))])
      .mockResolvedValueOnce([
        satelRow("arch1", new Date("2026-08-20T10:15:00.000Z")),
      ]);
    matchBucket.mockImplementation(async (_opts, candidates: { sourceRecordId: string }[]) => ({
      results: candidates.map(() => matchHit()),
    }));

    const result = await processVoipmonitorMatch({ trigger: "schedule" });
    expect(result.status).toBe("success");
    expect(result.hoursProcessed).toBe(2);
    expect(result.phonesParsed).toBe(2);
    expect(result.changesCount).toBe(2);
    expect(result.skipped).toBeUndefined();
    const meta = jobRunUpdate.mock.calls.at(-1)?.[0]?.data?.meta as {
      hours: Array<{ lane: string }>;
    };
    expect(meta.hours.map((hour) => hour.lane)).toEqual(["live", "archive"]);
  });

  it("still runs archive after a live API error and keeps live from rolling back", async () => {
    queryRaw
      .mockResolvedValueOnce([{ hour: new Date("2026-08-29T10:00:00.000Z") }])
      .mockResolvedValueOnce([{ hour: new Date("2026-08-20T10:00:00.000Z") }])
      .mockResolvedValue([]);
    findMany
      .mockResolvedValueOnce([satelRow("live1", new Date("2026-08-29T10:15:00.000Z"))])
      .mockResolvedValueOnce([
        satelRow("arch1", new Date("2026-08-20T10:15:00.000Z")),
      ]);
    matchBucket
      .mockResolvedValueOnce({
        results: [],
        error: new Error("vm down"),
      })
      .mockImplementation(async (_opts, candidates: { sourceRecordId: string }[]) => ({
        results: candidates.map(() => matchHit()),
      }));

    const result = await processVoipmonitorMatch({ trigger: "schedule" });
    expect(result.status).toBe("success");
    expect(result.hoursProcessed).toBe(2);
    expect(result.phonesParsed).toBe(1);
    expect(result.changesCount).toBe(1);
    expect(result.errorMessage).toContain("live");
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it("does not count a skipped job as progress", async () => {
    loadVoipmonitorRuntime.mockResolvedValue({
      enabled: false,
      ready: false,
      apiUrl: "",
      user: "",
      password: "",
      guiUrl: "",
    });
    const result = await processVoipmonitorMatch({ trigger: "schedule" });
    expect(result).toMatchObject({
      status: "success",
      skipped: true,
      hoursProcessed: 0,
    });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("stores a compact error when hour pick fails", async () => {
    queryRaw.mockRejectedValue({
      code: "P2002",
      message: [
        "Invalid `prisma.cdrRecord.findFirst()` invocation:",
        "",
        "Unique constraint failed",
      ].join("\n"),
    });
    const result = await processVoipmonitorMatch({ trigger: "schedule" });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("P2002: Unique constraint failed");
    expect(jobRunUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          errorMessage: "P2002: Unique constraint failed",
        }),
      }),
    );
  });

  it("returns empty success when no lane has work", async () => {
    queryRaw.mockResolvedValue([]);
    const result = await processVoipmonitorMatch({ trigger: "schedule" });
    expect(result.status).toBe("success");
    expect(result.hoursProcessed).toBe(0);
    expect(result.skipped).toBeUndefined();
    expect(matchBucket).not.toHaveBeenCalled();
    expect(queryRaw).toHaveBeenCalled();
  });
});
