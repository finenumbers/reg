import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiPermission = vi.fn();
const startUisSync = vi.fn();
const getUisSyncView = vi.fn();

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

vi.mock("@/modules/uis/service", () => ({
  startUisSync: (...args: unknown[]) => startUisSync(...args),
  getUisSyncView: (...args: unknown[]) => getUisSyncView(...args),
}));

import { POST } from "@/app/api/numbering-sync/uis/route";

describe("POST /api/numbering-sync/uis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an API key before a stage starts", async () => {
    requireApiPermission.mockResolvedValue({
      ok: true,
      ctx: { authKind: "apiKey" },
    });
    const response = await POST(
      new Request("http://localhost/api/numbering-sync/uis", { method: "POST" }),
    );
    expect(response.status).toBe(403);
    expect(startUisSync).not.toHaveBeenCalled();
  });
});
