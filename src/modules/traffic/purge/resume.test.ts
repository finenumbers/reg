import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORPHAN_RECLAIM_MESSAGE } from "@/modules/jobs/reclaim-orphans";

const findMany = vi.fn();
const update = vi.fn();
const count = vi.fn();
const queryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    jobRun: {
      findMany: (...args: unknown[]) => findMany(...args),
      update: (...args: unknown[]) => update(...args),
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
  continuesDelete,
  deletedCallsFromPurgeJob,
  enqueueAbandonedPurgeHistory,
  missingPurgeFkIndexNames,
  prepareCallContinuation,
  selectCallContinuation,
  selectResumeMonth,
  withContinueDelete,
  withoutContinueDelete,
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
  ["2026-08", { calls: 0, smg: 0, jobs: 40, audit: 12 }],
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
        remainders: new Map([["2026-08", { calls: 20, smg: 0, jobs: 40, audit: 12 }]]),
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
        remainders: new Map([["2026-07", { calls: 0, smg: 0, jobs: 5, audit: 1 }]]),
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
        remainders: new Map([["2026-10", { calls: 0, smg: 0, jobs: 4, audit: 1 }]]),
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
        remainders: new Map([["2026-08", { calls: 0, smg: 0, jobs: 0, audit: 0 }]]),
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
          ["2026-08", { calls: 0, smg: 0, jobs: 4, audit: 1 }],
          ["2026-07", { calls: 0, smg: 0, jobs: 2, audit: 0 }],
        ]),
      }),
    ).toEqual({ month: "2026-07", deletedCalls: 100 });
  });

  it("resumes a month with no CDR calls once SMG deletion has started and history remains", () => {
    expect(
      selectResumeMonth({
        jobs: [
          {
            errorMessage: ORPHAN_RECLAIM_MESSAGE,
            phonesParsed: 0,
            meta: { month: "2026-08", deletedSmg: 12, phase: "smg" },
          },
        ],
        currentMonth: "2026-10",
        remainders: new Map([["2026-08", { calls: 0, smg: 3, jobs: 2, audit: 0 }]]),
      }),
    ).toEqual({ month: "2026-08", deletedCalls: 0 });
  });

  it("resumes a month once card deletion has started and history remains", () => {
    expect(
      selectResumeMonth({
        jobs: [
          {
            errorMessage: ORPHAN_RECLAIM_MESSAGE,
            phonesParsed: 4,
            meta: { month: "2026-08", phase: "cards" },
          },
        ],
        currentMonth: "2026-10",
        remainders: new Map([["2026-08", { calls: 0, smg: 3, jobs: 2, audit: 0 }]]),
      }),
    ).toEqual({ month: "2026-08", deletedCalls: 4 });
  });

  it("leaves leftover SMG when jobs and audit are already gone", () => {
    expect(
      selectResumeMonth({
        jobs: [interruptedAugust()],
        currentMonth: "2026-10",
        remainders: new Map([["2026-08", { calls: 0, smg: 50, jobs: 0, audit: 0 }]]),
      }),
    ).toBeNull();
  });
});

describe("selectCallContinuation", () => {
  it("ignores an old interrupted month that still has calls", () => {
    expect(
      selectCallContinuation({
        jobs: [
          {
            ...interruptedAugust(),
            id: "old",
            justReclaimed: false,
          },
        ],
        currentMonth: "2026-10",
        remainders: new Map([["2026-08", { calls: 20, smg: 0, jobs: 1, audit: 0 }]]),
      }),
    ).toBeNull();
  });

  it("continues the purge this process just reclaimed", () => {
    expect(
      selectCallContinuation({
        jobs: [
          {
            id: "live",
            justReclaimed: true,
            errorMessage: ORPHAN_RECLAIM_MESSAGE,
            phonesParsed: 10,
            meta: { month: "2026-08", deletedCount: 10, phase: "calls" },
          },
        ],
        currentMonth: "2026-10",
        remainders: new Map([["2026-08", { calls: 20, smg: 0, jobs: 1, audit: 0 }]]),
      }),
    ).toEqual({ month: "2026-08", jobId: "live" });
  });

  it("continues a flagged month from the previous boot", () => {
    expect(
      selectCallContinuation({
        jobs: [
          {
            id: "flagged",
            justReclaimed: false,
            errorMessage: ORPHAN_RECLAIM_MESSAGE,
            phonesParsed: 10,
            meta: { month: "2026-08", continueDelete: true, deletedCount: 10 },
          },
        ],
        currentMonth: "2026-10",
        remainders: new Map([["2026-08", { calls: 4, smg: 0, jobs: 0, audit: 0 }]]),
      }),
    ).toEqual({ month: "2026-08", jobId: "flagged" });
  });

  it("does not continue a flagged month whose calls are already gone", () => {
    expect(
      selectCallContinuation({
        jobs: [
          {
            id: "flagged",
            justReclaimed: false,
            errorMessage: ORPHAN_RECLAIM_MESSAGE,
            phonesParsed: 10,
            meta: { month: "2026-08", continueDelete: true },
          },
        ],
        currentMonth: "2026-10",
        remainders: new Map([["2026-08", { calls: 0, smg: 2, jobs: 1, audit: 0 }]]),
      }),
    ).toBeNull();
  });

  it("keeps the continue flag beside the existing meta", () => {
    expect(withContinueDelete({ month: "2026-08", phase: "calls" })).toEqual({
      month: "2026-08",
      phase: "calls",
      continueDelete: true,
    });
    expect(withoutContinueDelete({ month: "2026-08", continueDelete: true })).toEqual({
      month: "2026-08",
    });
    expect(continuesDelete({ continueDelete: true })).toBe(true);
    expect(continuesDelete({ month: "2026-08" })).toBe(false);
  });
});

describe("prepareCallContinuation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    update.mockResolvedValue({});
    queryRaw.mockResolvedValue([{ n: 0 }]);
  });

  it("marks only the purge that was running and still has calls", async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(12);
    const result = await prepareCallContinuation([
      {
        id: "live",
        errorMessage: ORPHAN_RECLAIM_MESSAGE,
        phonesParsed: 10,
        meta: { month: "2026-08", deletedCount: 10, phase: "calls" },
      },
    ]);
    expect(result).toEqual({ month: "2026-08" });
    expect(update).toHaveBeenCalledWith({
      where: { id: "live" },
      data: {
        meta: {
          month: "2026-08",
          deletedCount: 10,
          phase: "calls",
          continueDelete: true,
        },
      },
    });
  });

  it("does not mark an old interrupted row", async () => {
    findMany.mockResolvedValue([
      {
        id: "old",
        errorMessage: ORPHAN_RECLAIM_MESSAGE,
        phonesParsed: 10,
        meta: { month: "2026-07", deletedCount: 10 },
      },
    ]);
    count.mockResolvedValue(40);
    await expect(prepareCallContinuation([])).resolves.toEqual({ month: null });
    expect(update).not.toHaveBeenCalled();
  });

  it("clears a flag once the month has no calls left", async () => {
    findMany.mockResolvedValue([
      {
        id: "flagged",
        errorMessage: ORPHAN_RECLAIM_MESSAGE,
        phonesParsed: 10,
        meta: { month: "2026-08", continueDelete: true, phase: "calls" },
      },
    ]);
    count.mockResolvedValue(0);
    await expect(prepareCallContinuation([])).resolves.toEqual({ month: null });
    expect(update).toHaveBeenCalledWith({
      where: { id: "flagged" },
      data: { meta: { month: "2026-08", phase: "calls" } },
    });
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
    const smgSql = readFileSync(
      path.join(process.cwd(), "prisma/migrations/20261013140000_smg_cdr/migration.sql"),
      "utf8",
    );
    const smgIndex = "smg_cdr_records_last_job_run_id_idx";
    expect(PURGE_FK_INDEX_NAMES).toContain(smgIndex);
    expect(smgSql).toContain(`"${smgIndex}"`);
    const purgeIndexes = PURGE_FK_INDEX_NAMES.filter((name) => name !== smgIndex);
    expect(purgeIndexes).toHaveLength(8);
    for (const name of purgeIndexes) {
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
