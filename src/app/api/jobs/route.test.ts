import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiPermission = vi.fn();
const listJobRuns = vi.fn();
const listAuditLogs = vi.fn();

vi.mock("@/modules/auth/guards", () => ({
  requireApiPermission: (...args: unknown[]) => requireApiPermission(...args),
}));

vi.mock("@/modules/jobs/query", () => ({
  listJobRuns: (...args: unknown[]) => listJobRuns(...args),
}));

vi.mock("@/modules/audit/query", () => ({
  listAuditLogs: (...args: unknown[]) => listAuditLogs(...args),
}));

import { GET as jobsGet } from "@/app/api/jobs/route";
import { GET as auditGet } from "@/app/api/audit/route";

describe("GET /api/jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns guard failure", async () => {
    requireApiPermission.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await jobsGet(new Request("http://localhost/api/jobs"));
    expect(res.status).toBe(403);
    expect(listJobRuns).not.toHaveBeenCalled();
  });

  it("lists jobs with status filter", async () => {
    requireApiPermission.mockResolvedValue({
      ok: true,
      ctx: { session: { user: { id: "u1" } } },
    });
    listJobRuns.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    });

    const res = await jobsGet(
      new Request("http://localhost/api/jobs?status=failed"),
    );
    expect(res.status).toBe(200);
    expect(listJobRuns).toHaveBeenCalledWith({
      status: "failed",
      actionCode: undefined,
      page: 1,
      pageSize: 100,
    });
  });

  it("rejects invalid status", async () => {
    requireApiPermission.mockResolvedValue({
      ok: true,
      ctx: { session: { user: { id: "u1" } } },
    });
    const res = await jobsGet(
      new Request("http://localhost/api/jobs?status=weird"),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires audit:read", async () => {
    requireApiPermission.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await auditGet(new Request("http://localhost/api/audit"));
    expect(res.status).toBe(403);
    expect(requireApiPermission).toHaveBeenCalledWith("audit:read");
  });

  it("lists audit logs with filters", async () => {
    requireApiPermission.mockResolvedValue({
      ok: true,
      ctx: { session: { user: { id: "u1" } } },
    });
    listAuditLogs.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    });

    const res = await auditGet(
      new Request("http://localhost/api/audit?action=ssh&actor=admin"),
    );
    expect(res.status).toBe(200);
    expect(listAuditLogs).toHaveBeenCalledWith({
      action: "ssh",
      actor: "admin",
      page: 1,
      pageSize: 100,
    });
  });
});
