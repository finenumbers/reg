import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiPermission = vi.fn();
const startSipoutSync = vi.fn();
const getNumberingSyncView = vi.fn();

vi.mock("@/modules/auth/guards", () => ({
  requireApiPermission: (...args: unknown[]) => requireApiPermission(...args),
}));

vi.mock("@/modules/auth/session", () => ({
  requireSessionUserId: (ctx: {
    authKind?: string;
    session?: { user?: { id?: string } };
  }) => {
    if (ctx.authKind !== "session") {
      throw new Error("API keys cannot perform this action");
    }
    return ctx.session?.user?.id ?? "";
  },
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => ({ ok: true }),
}));

vi.mock("@/lib/request-ip", () => ({
  getRequestIp: async () => null,
}));

vi.mock("@/modules/numbering-sync/service", () => ({
  startSipoutSync: (...args: unknown[]) => startSipoutSync(...args),
  getNumberingSyncView: (...args: unknown[]) => getNumberingSyncView(...args),
}));

import { POST } from "@/app/api/numbering-sync/free/route";

describe("POST /api/numbering-sync/free", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getNumberingSyncView.mockResolvedValue({
      host: "https://lk.sipout.net",
      hasKey: true,
    });
  });

  it("rejects an API key before the walk starts", async () => {
    requireApiPermission.mockResolvedValue({
      ok: true,
      ctx: { authKind: "apiKey" },
    });
    const response = await POST(
      new Request("http://localhost/api/numbering-sync/free", { method: "POST" }),
    );
    expect(response.status).toBe(403);
    expect(startSipoutSync).not.toHaveBeenCalled();
  });

  it("starts the walk for a session", async () => {
    requireApiPermission.mockResolvedValue({
      ok: true,
      ctx: { authKind: "session", session: { user: { id: "user-1" } } },
    });
    startSipoutSync.mockResolvedValue({ ok: true });
    const response = await POST(
      new Request("http://localhost/api/numbering-sync/free", { method: "POST" }),
    );
    expect(response.status).toBe(200);
    expect(startSipoutSync).toHaveBeenCalledWith("free", { userId: "user-1", ip: null });
  });
});
