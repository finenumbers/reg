import { beforeEach, describe, expect, it, vi } from "vitest";
import { PURGE_FK_INDEX_NAMES } from "@/modules/traffic/purge/resume";

const executeRaw = vi.fn();
const queryRaw = vi.fn();
const jobRunCreate = vi.fn();
const jobRunUpdate = vi.fn();
const cdrCount = vi.fn();
const queryMonthCallCounts = vi.fn();
const auditAppend = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    jobRun: {
      create: (...args: unknown[]) => jobRunCreate(...args),
      update: (...args: unknown[]) => jobRunUpdate(...args),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    cdrRecord: {
      count: (...args: unknown[]) => cdrCount(...args),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/modules/audit", () => ({
  AUDIT_ACTIONS: {
    CDR_PURGE_START: "cdr.purge.start",
    CDR_PURGE_FINISH: "cdr.purge.finish",
  },
  auditService: { append: (...args: unknown[]) => auditAppend(...args) },
}));

vi.mock("@/modules/traffic/poison", () => ({
  clearPurgeHolds: vi.fn(),
}));

vi.mock("@/modules/traffic/enqueue", () => ({
  requestCdrImportDrain: vi.fn(),
}));

vi.mock("@/modules/smg/enqueue", () => ({
  requestSmgImportDrain: vi.fn(),
}));

vi.mock("@/modules/smg/poison", () => ({
  clearSmgPurgeHolds: vi.fn(),
}));

const querySmgMonthCallCounts = vi.fn();

vi.mock("@/modules/smg/month-stats", () => ({
  querySmgMonthCallCounts: (...args: unknown[]) => querySmgMonthCallCounts(...args),
}));

vi.mock("@/modules/traffic/cdr-month-stats", () => ({
  invalidateCdrMonthCountCache: vi.fn(),
  queryMonthCallCounts: (...args: unknown[]) => queryMonthCallCounts(...args),
}));

import { clearPurgeHolds } from "@/modules/traffic/poison";
import {
  processCdrPurgeMonth,
  resolveDeletableMonthKey,
} from "@/modules/traffic/purge/processor";
import {
  getPurgeTargetMonth,
  purgeDeleteCommitted,
  resetPurgeTargetForTests,
} from "@/modules/traffic/purge/target";

function sqlText(sql: unknown): string {
  if (!sql || typeof sql !== "object" || !("strings" in sql)) return "";
  const strings = (sql as { strings?: string[] }).strings;
  return strings?.join(" ") ?? "";
}

describe("processCdrPurgeMonth historyOnly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPurgeTargetForTests();
    jobRunCreate.mockResolvedValue({ id: "resume-1" });
    jobRunUpdate.mockResolvedValue({});
    auditAppend.mockResolvedValue(undefined);
    executeRaw.mockResolvedValue(0);
    queryMonthCallCounts.mockImplementation(() => {
      throw new Error("deletable lookup");
    });
    queryRaw.mockImplementation(async (sql: unknown) => {
      const text = sqlText(sql);
      if (text.includes("pg_indexes")) {
        return PURGE_FK_INDEX_NAMES.map((indexname) => ({ indexname }));
      }
      if (text.includes("job_runs")) return [{ n: 0 }];
      if (text.includes("audit_logs")) return [{ n: 0 }];
      return [];
    });
    cdrCount.mockResolvedValue(0);
  });

  it("finishes August history when September is the month that still has calls", async () => {
    const result = await processCdrPurgeMonth({
      trigger: "schedule",
      month: "2026-08",
      historyOnly: true,
      deletedCalls: 209554,
    });
    expect(result.status).toBe("success");
    expect(result.phonesParsed).toBe(209554);
    expect(queryMonthCallCounts).not.toHaveBeenCalled();
    expect(jobRunCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phonesParsed: 209554,
          meta: expect.objectContaining({
            month: "2026-08",
            deletedCount: 209554,
            historyOnly: true,
          }),
        }),
      }),
    );
    const createOrder = jobRunCreate.mock.invocationCallOrder[0] ?? 0;
    const deleteOrder = executeRaw.mock.invocationCallOrder[0] ?? 0;
    expect(createOrder).toBeGreaterThan(0);
    expect(deleteOrder).toBeGreaterThan(createOrder);
    expect(jobRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "success",
          phonesParsed: 209554,
        }),
      }),
    );
  });

  it("does not delete when the month still has calls", async () => {
    cdrCount.mockResolvedValue(15);
    const result = await processCdrPurgeMonth({
      trigger: "schedule",
      month: "2026-08",
      historyOnly: true,
      deletedCalls: 209554,
    });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("ещё есть звонки");
    expect(executeRaw).not.toHaveBeenCalled();
    expect(clearPurgeHolds).toHaveBeenCalledWith("2026-08");
    expect(getPurgeTargetMonth()).toBeNull();
    expect(queryMonthCallCounts).not.toHaveBeenCalled();
  });

  it("fails before any delete when a foreign-key index is missing", async () => {
    queryRaw.mockResolvedValue([]);
    const result = await processCdrPurgeMonth({
      trigger: "schedule",
      month: "2026-08",
      historyOnly: true,
      deletedCalls: 209554,
    });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("Нет индексов");
    expect(result.errorMessage).toContain("cdr_records_lastJobRunId_idx");
    expect(executeRaw).not.toHaveBeenCalled();
    expect(cdrCount).not.toHaveBeenCalled();
    expect(clearPurgeHolds).toHaveBeenCalledWith("2026-08");
    expect(getPurgeTargetMonth()).toBeNull();
  });

  it("deletes remaining SMG calls before jobs and publishes that phase", async () => {
    queryRaw.mockImplementation(async (sql: unknown) => {
      const text = sqlText(sql);
      if (text.includes("pg_indexes")) {
        return PURGE_FK_INDEX_NAMES.map((indexname) => ({ indexname }));
      }
      if (text.includes("smg_cdr_records") && text.includes("COUNT")) return [{ n: 5 }];
      if (text.includes("job_runs")) return [{ n: 2 }];
      if (text.includes("audit_logs")) return [{ n: 1 }];
      return [];
    });
    const result = await processCdrPurgeMonth({
      trigger: "schedule",
      month: "2026-08",
      historyOnly: true,
      deletedCalls: 10,
    });
    expect(result.status).toBe("success");
    const deletes = executeRaw.mock.calls.map((call) => sqlText(call[0]));
    expect(deletes[0]).toContain("DELETE FROM smg_cdr_records");
    expect(deletes.findIndex((sql) => sql.includes("DELETE FROM job_runs"))).toBeGreaterThan(0);
    const phases = jobRunUpdate.mock.calls.map((call) => {
      const meta = (call[0] as { data?: { meta?: { phase?: string } } }).data?.meta;
      return meta?.phase;
    });
    expect(phases.indexOf("smg")).toBeGreaterThanOrEqual(0);
    expect(phases.indexOf("smg")).toBeLessThan(phases.indexOf("jobs"));
  });

  it("releases the hold when history finishes without deleting a batch", async () => {
    const result = await processCdrPurgeMonth({
      trigger: "schedule",
      month: "2026-08",
      historyOnly: true,
      deletedCalls: 10,
    });
    expect(result.status).toBe("success");
    expect(clearPurgeHolds).toHaveBeenCalledWith("2026-08");
    expect(getPurgeTargetMonth()).toBeNull();
    expect(purgeDeleteCommitted()).toBe(false);
  });

  it("keeps the hold after a committed batch, including a later failure that deletes nothing", async () => {
    let batches = 0;
    executeRaw.mockImplementation(async () => {
      batches += 1;
      if (batches === 1) return 4;
      throw new Error("disk");
    });
    const first = await processCdrPurgeMonth({
      trigger: "schedule",
      month: "2026-08",
      historyOnly: true,
      deletedCalls: 10,
    });
    expect(first.status).toBe("failed");
    expect(first.errorMessage).toBe("disk");
    expect(clearPurgeHolds).not.toHaveBeenCalled();
    expect(getPurgeTargetMonth()).toBe("2026-08");
    expect(purgeDeleteCommitted()).toBe(true);

    queryRaw.mockResolvedValue([]);
    const second = await processCdrPurgeMonth({
      trigger: "schedule",
      month: "2026-08",
      historyOnly: true,
      deletedCalls: 10,
    });
    expect(second.status).toBe("failed");
    expect(second.errorMessage).toContain("Нет индексов");
    expect(clearPurgeHolds).not.toHaveBeenCalled();
    expect(getPurgeTargetMonth()).toBe("2026-08");
    expect(purgeDeleteCommitted()).toBe(true);
  });
});

describe("resolveDeletableMonthKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPurgeTargetForTests();
  });

  it("picks the oldest month that has SMG rows when CDR is newer", async () => {
    queryMonthCallCounts.mockResolvedValue([
      { year: 2026, month: 9, key: "2026-09", count: 10 },
    ]);
    querySmgMonthCallCounts.mockResolvedValue([
      { year: 2026, month: 8, key: "2026-08", count: 4 },
    ]);
    await expect(resolveDeletableMonthKey()).resolves.toBe("2026-08");
  });
});
