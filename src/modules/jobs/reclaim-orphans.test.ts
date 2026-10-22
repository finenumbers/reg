import { beforeEach, describe, expect, it, vi } from "vitest";

const updateMany = vi.fn();
const findMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    jobRun: {
      updateMany: (...args: unknown[]) => updateMany(...args),
      findMany: (...args: unknown[]) => findMany(...args),
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
  ORPHAN_RECLAIM_MESSAGE,
  reclaimOrphanJobRuns,
} from "@/modules/jobs/reclaim-orphans";

describe("reclaimOrphanJobRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([]);
  });

  it("marks running job_runs as failed with restart message", async () => {
    updateMany.mockResolvedValue({ count: 2 });
    const result = await reclaimOrphanJobRuns();
    expect(result).toEqual({ reclaimed: 2, runningPurges: [] });
    expect(findMany).toHaveBeenCalledWith({
      where: { status: "running", actionCode: "cdr.purge.month" },
      select: { id: true, errorMessage: true, phonesParsed: true, meta: true },
    });
    const found = findMany.mock.invocationCallOrder[0] ?? 0;
    const marked = updateMany.mock.invocationCallOrder[0] ?? 0;
    expect(found).toBeGreaterThan(0);
    expect(marked).toBeGreaterThan(found);
    expect(updateMany).toHaveBeenCalledWith({
      where: { status: "running" },
      data: {
        status: "failed",
        finishedAt: expect.any(Date),
        errorMessage: ORPHAN_RECLAIM_MESSAGE,
      },
    });
  });

  it("returns the purge that was still running", async () => {
    const row = {
      id: "purge-1",
      errorMessage: null,
      phonesParsed: 10,
      meta: { month: "2026-08", phase: "calls" },
    };
    findMany.mockResolvedValue([row]);
    updateMany.mockResolvedValue({ count: 1 });
    await expect(reclaimOrphanJobRuns()).resolves.toEqual({
      reclaimed: 1,
      runningPurges: [row],
    });
  });

  it("returns zero when nothing to reclaim", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(reclaimOrphanJobRuns()).resolves.toEqual({
      reclaimed: 0,
      runningPurges: [],
    });
  });
});
