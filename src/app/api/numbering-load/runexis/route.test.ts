import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiPermission = vi.fn();
const saveRunexisAccess = vi.fn();
const getRunexisAccessView = vi.fn();

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
  saveRunexisAccess: (...args: unknown[]) => saveRunexisAccess(...args),
  getRunexisAccessView: (...args: unknown[]) => getRunexisAccessView(...args),
}));

import { PUT } from "@/app/api/numbering-load/runexis/route";

describe("PUT /api/numbering-load/runexis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an API key before the password is stored", async () => {
    requireApiPermission.mockResolvedValue({
      ok: true,
      ctx: { authKind: "apiKey" },
    });
    const response = await PUT(
      new Request("http://localhost/api/numbering-load/runexis", {
        method: "PUT",
        body: JSON.stringify({ email: "a@b.c", password: "secret" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(saveRunexisAccess).not.toHaveBeenCalled();
  });

  it("rejects a field outside email and password", async () => {
    requireApiPermission.mockResolvedValue({
      ok: true,
      ctx: { authKind: "session", session: { user: { id: "user-1" } } },
    });
    const response = await PUT(
      new Request("http://localhost/api/numbering-load/runexis", {
        method: "PUT",
        body: JSON.stringify({ email: "a@b.c", password: "secret", token: "no" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(saveRunexisAccess).not.toHaveBeenCalled();
  });
});
