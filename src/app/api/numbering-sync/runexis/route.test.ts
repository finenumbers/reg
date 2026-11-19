import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiPermission = vi.fn();
const startRunexisPurchased = vi.fn();
const startRunexisFree = vi.fn();
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
  startRunexisPurchased: (...args: unknown[]) => startRunexisPurchased(...args),
  startRunexisFree: (...args: unknown[]) => startRunexisFree(...args),
  getRunexisSyncView: (...args: unknown[]) => getRunexisSyncView(...args),
}));

import { POST as postPurchased } from "@/app/api/numbering-sync/runexis/purchased/route";
import { POST as postFree } from "@/app/api/numbering-sync/runexis/free/route";

const session = {
  ok: true,
  ctx: { authKind: "session", session: { user: { id: "user-1" } } },
};

describe("POST /api/numbering-sync/runexis/purchased", () => {
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
    const response = await postPurchased(
      new Request("http://localhost/api/numbering-sync/runexis/purchased", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
    expect(startRunexisPurchased).not.toHaveBeenCalled();
    expect(startRunexisFree).not.toHaveBeenCalled();
  });

  it("starts the purchased list for a session and ignores the body", async () => {
    requireApiPermission.mockResolvedValue(session);
    startRunexisPurchased.mockResolvedValue({ ok: true });
    const response = await postPurchased(
      new Request("http://localhost/api/numbering-sync/runexis/purchased", {
        method: "POST",
        body: JSON.stringify({ provider: "SipOut" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(startRunexisPurchased).toHaveBeenCalledWith({ userId: "user-1", ip: null });
    expect(startRunexisFree).not.toHaveBeenCalled();
  });
});

describe("POST /api/numbering-sync/runexis/free", () => {
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
    const response = await postFree(
      new Request("http://localhost/api/numbering-sync/runexis/free", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
    expect(startRunexisFree).not.toHaveBeenCalled();
    expect(startRunexisPurchased).not.toHaveBeenCalled();
  });

  it("starts the free list for a session and ignores the body", async () => {
    requireApiPermission.mockResolvedValue(session);
    startRunexisFree.mockResolvedValue({ ok: true });
    const response = await postFree(
      new Request("http://localhost/api/numbering-sync/runexis/free", {
        method: "POST",
        body: JSON.stringify({ provider: "SipOut" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(startRunexisFree).toHaveBeenCalledWith({ userId: "user-1", ip: null });
    expect(startRunexisPurchased).not.toHaveBeenCalled();
  });
});
