import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiPermission = vi.fn();
const beginSmgExportJob = vi.fn();
const readSmgExportJob = vi.fn();
const takeSmgExportFile = vi.fn();
const assertSameOrigin = vi.fn();
const cdrVacuumBusyResponse = vi.fn();

vi.mock("@/modules/auth/guards", () => ({
  requireApiPermission: (...args: unknown[]) => requireApiPermission(...args),
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: (...args: unknown[]) => assertSameOrigin(...args),
}));

vi.mock("@/modules/smg/export-job", () => ({
  beginSmgExportJob: (...args: unknown[]) => beginSmgExportJob(...args),
  readSmgExportJob: (...args: unknown[]) => readSmgExportJob(...args),
  takeSmgExportFile: (...args: unknown[]) => takeSmgExportFile(...args),
}));

vi.mock("@/modules/storage/vacuum/http", () => ({
  cdrVacuumBusyResponse: () => cdrVacuumBusyResponse(),
}));

import { POST } from "@/app/api/smg/export/route";
import { GET as getStatus } from "@/app/api/smg/export/[id]/route";
import { GET as download } from "@/app/api/smg/export/[id]/download/route";

const sessionGate = {
  ok: true as const,
  ctx: { authKind: "session" as const, session: { user: { id: "user-1" } } },
};

const keyGate = {
  ok: true as const,
  ctx: { authKind: "api_key" as const },
};

function startRequest(): Request {
  return new Request("http://localhost/api/smg/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ layout: "calls", month: "2026-10" }),
  });
}

describe("SMG export session guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertSameOrigin.mockReturnValue({ ok: true });
    cdrVacuumBusyResponse.mockReturnValue(null);
    beginSmgExportJob.mockReturnValue({ id: "job-1", status: "running", error: null });
    readSmgExportJob.mockReturnValue({ id: "job-1", status: "running", error: null });
    takeSmgExportFile.mockReturnValue(null);
  });

  it("refuses a machine key on start, status, and download", async () => {
    requireApiPermission.mockResolvedValue(keyGate);

    const started = await POST(startRequest());
    const status = await getStatus(new Request("http://localhost/api/smg/export/job-1"), {
      params: Promise.resolve({ id: "job-1" }),
    });
    const file = await download(new Request("http://localhost/api/smg/export/job-1/download"), {
      params: Promise.resolve({ id: "job-1" }),
    });

    expect(started.status).toBe(403);
    expect(status.status).toBe(403);
    expect(file.status).toBe(403);
    expect(beginSmgExportJob).not.toHaveBeenCalled();
    expect(readSmgExportJob).not.toHaveBeenCalled();
    expect(takeSmgExportFile).not.toHaveBeenCalled();
  });

  it("starts, reads, and reaches download for a browser session", async () => {
    requireApiPermission.mockResolvedValue(sessionGate);

    const started = await POST(startRequest());
    const status = await getStatus(new Request("http://localhost/api/smg/export/job-1"), {
      params: Promise.resolve({ id: "job-1" }),
    });
    const file = await download(new Request("http://localhost/api/smg/export/job-1/download"), {
      params: Promise.resolve({ id: "job-1" }),
    });

    expect(started.status).toBe(200);
    expect(await started.json()).toEqual({
      job: { id: "job-1", status: "running", error: null },
    });
    expect(beginSmgExportJob).toHaveBeenCalledOnce();
    expect(status.status).toBe(200);
    expect(readSmgExportJob).toHaveBeenCalledWith("job-1");
    expect(file.status).toBe(409);
    expect(takeSmgExportFile).toHaveBeenCalledWith("job-1");
  });
});
