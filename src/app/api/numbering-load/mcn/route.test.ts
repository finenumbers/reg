import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiPermission = vi.fn();
const saveMcnAccess = vi.fn();
const getMcnAccessView = vi.fn();

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

vi.mock("@/modules/mcn/service", () => ({
  saveMcnAccess: (...args: unknown[]) => saveMcnAccess(...args),
  getMcnAccessView: (...args: unknown[]) => getMcnAccessView(...args),
}));

import { PUT } from "@/app/api/numbering-load/mcn/route";

describe("PUT /api/numbering-load/mcn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an API key before the key is stored", async () => {
    requireApiPermission.mockResolvedValue({
      ok: true,
      ctx: { authKind: "apiKey" },
    });
    const response = await PUT(
      new Request("http://localhost/api/numbering-load/mcn", {
        method: "PUT",
        body: JSON.stringify({ token: "secret" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(saveMcnAccess).not.toHaveBeenCalled();
  });
});
