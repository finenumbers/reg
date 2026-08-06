import { beforeEach, describe, expect, it, vi } from "vitest";

const updateMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    jobRun: {
      updateMany: (...args: unknown[]) => updateMany(...args),
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
  });

  it("marks running job_runs as failed with restart message", async () => {
    updateMany.mockResolvedValue({ count: 2 });
    const result = await reclaimOrphanJobRuns();
    expect(result).toEqual({ reclaimed: 2 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { status: "running" },
      data: {
        status: "failed",
        finishedAt: expect.any(Date),
        errorMessage: ORPHAN_RECLAIM_MESSAGE,
      },
    });
  });

  it("returns zero when nothing to reclaim", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(reclaimOrphanJobRuns()).resolves.toEqual({ reclaimed: 0 });
  });
});
