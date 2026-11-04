import { beforeEach, describe, expect, it, vi } from "vitest";

const createJobRun = vi.fn();
const updateJobRun = vi.fn();
const updateManyJobRun = vi.fn();
const appendAudit = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    jobRun: {
      create: (...args: unknown[]) => createJobRun(...args),
      update: (...args: unknown[]) => updateJobRun(...args),
      updateMany: (...args: unknown[]) => updateManyJobRun(...args),
    },
  },
}));

vi.mock("@/modules/audit", () => ({
  AUDIT_ACTIONS: {
    GROUPS_SYNC_MANUAL: "groups.sync_manual",
    GROUPS_SYNC_START: "groups.sync_start",
    GROUPS_SYNC_FINISH: "groups.sync_finish",
  },
  auditService: {
    append: (...args: unknown[]) => appendAudit(...args),
  },
}));

import { processGroupsSync } from "@/modules/groups/groups-sync-processor";

describe("processGroupsSync", () => {
  beforeEach(() => {
    createJobRun.mockReset();
    updateJobRun.mockReset();
    updateManyJobRun.mockReset();
    appendAudit.mockReset();
    createJobRun.mockResolvedValue({ id: "job-1" });
    updateJobRun.mockResolvedValue({});
    updateManyJobRun.mockResolvedValue({ count: 0 });
    appendAudit.mockResolvedValue(undefined);
  });

  it("replaces the catalog with the current list, including an empty one", async () => {
    const apply = vi.fn().mockResolvedValue({ groupCount: 0 });
    const result = await processGroupsSync(
      { trigger: "schedule" },
      {
        read: async () => ({ ok: true, groups: [] }),
        apply,
      },
    );
    expect(result.status).toBe("success");
    expect(result.groupCount).toBe(0);
    expect(apply).toHaveBeenCalledWith({ version: 0, groups: [] }, "job-1", expect.any(Date));
    expect(updateJobRun).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "success", phonesParsed: 0 }),
      }),
    );
  });

  it("leaves the catalog in place when the read fails and does not store a body", async () => {
    const apply = vi.fn();
    const result = await processGroupsSync(
      { trigger: "schedule" },
      {
        read: async () => ({ ok: false, detail: "Учётка API РТУ не задана." }),
        apply,
      },
    );
    expect(result).toMatchObject({
      status: "failed",
      errorMessage: "Учётка API РТУ не задана.",
      groupCount: 0,
    });
    expect(apply).not.toHaveBeenCalled();
    const stored = JSON.stringify(updateJobRun.mock.calls);
    expect(stored).not.toContain("Envelope");
    expect(stored).not.toContain("selectRowset");
  });

  it("does not apply a name that contains a semicolon", async () => {
    const apply = vi.fn();
    const result = await processGroupsSync(
      { trigger: "schedule" },
      {
        read: async () => ({
          ok: true,
          groups: [{ externalId: "1", name: "A;B" }],
        }),
        apply,
      },
    );
    expect(result.status).toBe("failed");
    expect(apply).not.toHaveBeenCalled();
  });
});
