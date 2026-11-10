import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiPermission = vi.fn();

vi.mock("@/modules/auth/guards", () => ({
  requireApiPermission: (...args: unknown[]) => requireApiPermission(...args),
}));

import { requireVatsUser } from "@/modules/vats/http";

describe("requireVatsUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an API key", async () => {
    requireApiPermission.mockResolvedValue({
      ok: true,
      ctx: { authKind: "api_key", apiKey: { id: "k" } },
    });
    const gate = await requireVatsUser("vats:write");
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.response.status).toBe(403);
      await expect(gate.response.json()).resolves.toEqual({
        error: "Ключ API не может обращаться к ВАТС.",
        code: "FORBIDDEN",
      });
    }
  });

  it("accepts a browser session", async () => {
    requireApiPermission.mockResolvedValue({
      ok: true,
      ctx: { authKind: "session", session: { user: { id: "admin-1" } } },
    });
    await expect(requireVatsUser("vats:write")).resolves.toEqual({
      ok: true,
      userId: "admin-1",
    });
  });
});
