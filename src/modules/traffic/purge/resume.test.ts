import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORPHAN_RECLAIM_MESSAGE } from "@/modules/jobs/reclaim-orphans";

const findMany = vi.fn();
const count = vi.fn();
const queryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    jobRun: {
      findMany: (...args: unknown[]) => findMany(...args),
    },
    cdrRecord: {
      count: (...args: unknown[]) => count(...args),
    },
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  PURGE_FK_INDEX_NAMES,
  deletedCallsFromPurgeJob,
  enqueueAbandonedPurgeHistory,
  missingPurgeFkIndexNames,
  selectResumeMonth,
  type ResumePurgeJob,
} from "@/modules/traffic/purge/resume";

const augustMeta = {
  month: "2026-08",
  targetCount: 209554,
  deletedCount: 209554,
};

function interruptedAugust(): ResumePurgeJob {
  return {
    errorMessage: ORPHAN_RECLAIM_MESSAGE,
    phonesParsed: 209554,
    meta: augustMeta,
  };
}

const augustLeft = new Map([
  ["2026-08", { calls: 0, jobs: 40, audit: 12 }],
]);

describe("selectResumeMonth", () => {
  it("resumes the old purge row once its calls are gone", () => {
    expect(
      selectResumeMonth({
        jobs: [interruptedAugust()],
        currentMonth: "2026-10",
        remainders: augustLeft,
      }),
    ).toEqual({ month: "2026-08", deletedCalls: 209554 });
    expect(deletedCallsFromPurgeJob({ ...interruptedAugust(), phonesParsed: null })).toBe(
      209554,
    );
  });

  it("leaves a month that still has calls", () => {
    expect(
      selectResumeMonth({
        jobs: [interruptedAugust()],
        currentMonth: "2026-10",
        remainders: new Map([["2026-08", { calls: 20, jobs: 40, audit: 12 }]]),
      }),
    ).toBeNull();
  });

  it("ignores a successful purge and a month with no purge job", () => {
    expect(
      selectResumeMonth({
        jobs: [
          {
            errorMessage: "Удалено 10 звонков",
            phonesParsed: 10,
            meta: { month: "2026-07", deletedCount: 10 },
          },
        ],
        currentMonth: "2026-10",
        remainders: new Map([["2026-07", { calls: 0, jobs: 5, audit: 1 }]]),
      }),
    ).toBeNull();
    expect(
      selectResumeMonth({
        jobs: [],
        currentMonth: "2026-10",
        remainders: augustLeft,
      }),
    ).toBeNull();
  });

  it("does not resume the current month", () => {
    expect(
      selectResumeMonth({
        jobs: [
          {
            errorMessage: ORPHAN_RECLAIM_MESSAGE,
            phonesParsed: 10,
            meta: { month: "2026-10", deletedCount: 10 },
          },
        ],
        currentMonth: "2026-10",
        remainders: new Map([["2026-10", { calls: 0, jobs: 4, audit: 1 }]]),
      }),
    ).toBeNull();
  });

  it("keeps the interrupted month when a newer index failure is in the list", () => {
    expect(
      selectResumeMonth({
        jobs: [
          {
            errorMessage: "Нет индексов для удаления задач: cdr_records_lastJobRunId_idx",
            phonesParsed: 209554,
            meta: augustMeta,
          },
          interruptedAugust(),
        ],
        currentMonth: "2026-10",
        remainders: augustLeft,
      }),
    ).toEqual({ month: "2026-08", deletedCalls: 209554 });
  });

  it("skips a month whose jobs and audit are already gone", () => {
    expect(
      selectResumeMonth({
        jobs: [interruptedAugust()],
        currentMonth: "2026-10",
        remainders: new Map([["2026-08", { calls: 0, jobs: 0, audit: 0 }]]),
      }),
    ).toBeNull();
  });

  it("picks the oldest month when two interrupted purges still have history", () => {
    expect(
      selectResumeMonth({
        jobs: [
          interruptedAugust(),
          {
            errorMessage: ORPHAN_RECLAIM_MESSAGE,
            phonesParsed: 100,
            meta: { month: "2026-07", deletedCount: 100 },
          },
        ],
        currentMonth: "2026-10",
        remainders: new Map([
          ["2026-08", { calls: 0, jobs: 4, audit: 1 }],
          ["2026-07", { calls: 0, jobs: 2, audit: 0 }],
        ]),
      }),
    ).toEqual({ month: "2026-07", deletedCalls: 100 });
  });
});

describe("purge foreign-key indexes", () => {
  it("names every index the purge migration creates", () => {
    const sql = readFileSync(
      path.join(
        process.cwd(),
        "prisma/migrations/20261010200000_purge_fk_indexes/migration.sql",
      ),
      "utf8",
    );
    expect(PURGE_FK_INDEX_NAMES).toHaveLength(8);
    for (const name of PURGE_FK_INDEX_NAMES) {
      expect(sql).toContain(`"${name}"`);
    }
    expect(missingPurgeFkIndexNames([])).toEqual([...PURGE_FK_INDEX_NAMES]);
    expect(missingPurgeFkIndexNames(PURGE_FK_INDEX_NAMES)).toEqual([]);
  });
});

describe("enqueueAbandonedPurgeHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues history-only for the interrupted month", async () => {
    findMany.mockResolvedValue([interruptedAugust()]);
    count.mockResolvedValue(0);
    queryRaw.mockImplementation(async (sql: { strings?: string[] }) => {
      const text = sql.strings?.join(" ") ?? "";
      if (text.includes("job_runs")) return [{ n: 40 }];
      if (text.includes("audit_logs")) return [{ n: 12 }];
      return [];
    });
    const enqueue = vi.fn().mockResolvedValue({ accepted: true });
    await expect(enqueueAbandonedPurgeHistory(enqueue)).resolves.toEqual({
      month: "2026-08",
      accepted: true,
    });
    expect(enqueue).toHaveBeenCalledWith({
      actionCode: "cdr.purge.month",
      trigger: "schedule",
      month: "2026-08",
      historyOnly: true,
      deletedCalls: 209554,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          actionCode: "cdr.purge.month",
          status: "failed",
          errorMessage: ORPHAN_RECLAIM_MESSAGE,
        },
        take: 20,
      }),
    );
  });

  it("does not enqueue while the month still has calls", async () => {
    findMany.mockResolvedValue([interruptedAugust()]);
    count.mockResolvedValue(15);
    queryRaw.mockResolvedValue([{ n: 40 }]);
    const enqueue = vi.fn();
    await expect(enqueueAbandonedPurgeHistory(enqueue)).resolves.toEqual({
      month: null,
      accepted: false,
    });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
