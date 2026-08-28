import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const update = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    enrichJob: {
      findMany: (...args: unknown[]) => findMany(...args),
      update: (...args: unknown[]) => update(...args),
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

  it("marks queued/running enrich jobs as failed and errors open stages", async () => {
    findMany.mockResolvedValue([
      {
        id: "job-1",
        stages: [
          { id: "parse", label: "parse", status: "done" },
          { id: "phones", label: "phones", status: "running" },
        ],
      },
    ]);
    update.mockResolvedValue({});
    await expect(reclaimOrphanEnrichJobs()).resolves.toEqual({ reclaimed: 1 });
    expect(update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        status: "failed",
        finishedAt: expect.any(Date),
        errorMessage: ENRICH_ORPHAN_MESSAGE,
        stages: [
          { id: "parse", label: "parse", status: "done" },
          {
            id: "phones",
            label: "phones",
            status: "error",
            detail: ENRICH_ORPHAN_MESSAGE,
          },
        ],
      },
    });
  });
});
