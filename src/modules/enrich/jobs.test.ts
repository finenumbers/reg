import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const findUnique = vi.fn();
const deleteRow = vi.fn();
const removeJobDir = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    enrichJob: {
      findFirst: (...args: unknown[]) => findFirst(...args),
      findUnique: (...args: unknown[]) => findUnique(...args),
      delete: (...args: unknown[]) => deleteRow(...args),
    },
  },
}));

vi.mock("@/modules/enrich/reclaim", () => ({
  removeJobDir: (...args: unknown[]) => removeJobDir(...args),
}));

import {
  dismissFinishedEnrichJob,
  getCurrentEnrichJob,
} from "@/modules/enrich/jobs";

describe("getCurrentEnrichJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads only the user's in-progress job", async () => {
    findFirst.mockResolvedValue(null);
    await expect(getCurrentEnrichJob("user-1")).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith({
      where: { actorUserId: "user-1", status: { in: ["queued", "running"] } },
      orderBy: { createdAt: "desc" },
    });
  });
});

describe("dismissFinishedEnrichJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes files and the row for a completed job", async () => {
    findUnique.mockResolvedValue({
      id: "job-1",
      actorUserId: "user-1",
      status: "completed",
    });
    deleteRow.mockResolvedValue({});
    await expect(dismissFinishedEnrichJob("job-1", "user-1")).resolves.toBe(
      "dismissed",
    );
    expect(removeJobDir).toHaveBeenCalledWith("job-1");
    expect(deleteRow).toHaveBeenCalledWith({ where: { id: "job-1" } });
  });

  it("does not delete a running job", async () => {
    findUnique.mockResolvedValue({
      id: "job-1",
      actorUserId: "user-1",
      status: "running",
    });
    await expect(dismissFinishedEnrichJob("job-1", "user-1")).resolves.toBe(
      "active",
    );
    expect(removeJobDir).not.toHaveBeenCalled();
    expect(deleteRow).not.toHaveBeenCalled();
  });

  it("returns not_found for another user's job", async () => {
    findUnique.mockResolvedValue({
      id: "job-1",
      actorUserId: "other",
      status: "completed",
    });
    await expect(dismissFinishedEnrichJob("job-1", "user-1")).resolves.toBe(
      "not_found",
    );
    expect(removeJobDir).not.toHaveBeenCalled();
  });
});
