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

vi.mock("@/modules/traffic/cdr-month-stats", () => ({
  invalidateCdrMonthCountCache: vi.fn(),
  queryMonthCallCounts: (...args: unknown[]) => queryMonthCallCounts(...args),
}));

import { processCdrPurgeMonth } from "@/modules/traffic/purge/processor";

function sqlText(sql: unknown): string {
  if (!sql || typeof sql !== "object" || !("strings" in sql)) return "";
  const strings = (sql as { strings?: string[] }).strings;
  return strings?.join(" ") ?? "";
}

describe("processCdrPurgeMonth historyOnly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });
});
