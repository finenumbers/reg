import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiPermission = vi.fn();
const startRunexisSync = vi.fn();
const getRunexisSyncView = vi.fn();

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

vi.mock("@/modules/runexis/service", () => ({
  startRunexisSync: (...args: unknown[]) => startRunexisSync(...args),
  getRunexisSyncView: (...args: unknown[]) => getRunexisSyncView(...args),
}));

import { POST } from "@/app/api/numbering-sync/runexis/route";

describe("POST /api/numbering-sync/runexis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRunexisSyncView.mockResolvedValue({
      host: "https://didapi.runexis.ru",
      email: "a@b.c",
      hasPassword: true,
    });
  });

  it("rejects an API key before the stage starts", async () => {
    requireApiPermission.mockResolvedValue({
      ok: true,
      ctx: { authKind: "apiKey" },
    });
    const response = await POST(
      new Request("http://localhost/api/numbering-sync/runexis", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
    expect(startRunexisSync).not.toHaveBeenCalled();
  });

  it("starts one Runexis stage for a session", async () => {
    requireApiPermission.mockResolvedValue({
      ok: true,
      ctx: { authKind: "session", session: { user: { id: "user-1" } } },
    });
    startRunexisSync.mockResolvedValue({ ok: true });
    const response = await POST(
      new Request("http://localhost/api/numbering-sync/runexis", {
        method: "POST",
        body: JSON.stringify({ provider: "SipOut" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(startRunexisSync).toHaveBeenCalledWith({ userId: "user-1", ip: null });
  });
});
