import { beforeEach, describe, expect, it, vi } from "vitest";

const updateMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    enrichJob: {
      updateMany: (...args: unknown[]) => updateMany(...args),
      findMany: vi.fn().mockResolvedValue([]),
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
  ENRICH_ORPHAN_MESSAGE,
  reclaimOrphanEnrichJobs,
} from "@/modules/enrich/reclaim";

describe("reclaimOrphanEnrichJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks queued/running enrich jobs as failed", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await expect(reclaimOrphanEnrichJobs()).resolves.toEqual({ reclaimed: 1 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { status: { in: ["queued", "running"] } },
      data: {
        status: "failed",
        finishedAt: expect.any(Date),
        errorMessage: ENRICH_ORPHAN_MESSAGE,
      },
    });
  });
});
