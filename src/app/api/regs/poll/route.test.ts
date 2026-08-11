import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiPermission = vi.fn();
const enqueue = vi.fn();
const assertSameOrigin = vi.fn();
const pollRateLimiterCheck = vi.fn();

vi.mock("@/modules/auth/guards", () => ({
  requireApiPermission: (...args: unknown[]) => requireApiPermission(...args),
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: (...args: unknown[]) => assertSameOrigin(...args),
}));

vi.mock("@/lib/rate-limit", () => ({
  pollRateLimiter: {
    check: (...args: unknown[]) => pollRateLimiterCheck(...args),
  },
}));

vi.mock("@/modules/jobs/runtime", () => ({
  jobRuntime: {
    enqueue: (...args: unknown[]) => enqueue(...args),
  },
}));

import { POST } from "@/app/api/regs/poll/route";

describe("POST /api/regs/poll hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertSameOrigin.mockReturnValue({ ok: true });
    pollRateLimiterCheck.mockReturnValue({
      allowed: true,
      remaining: 5,
      retryAfterSec: 0,
    });
  });

  it("rejects bad origin before auth", async () => {
    assertSameOrigin.mockReturnValue({
      ok: false,
      response: Response.json({ code: "CSRF_ORIGIN" }, { status: 403 }),
    });
    const res = await POST(
      new Request("http://localhost/api/regs/poll", { method: "POST" }),
    );
    expect(res.status).toBe(403);
    expect(requireApiPermission).not.toHaveBeenCalled();
  });

  it("rate limits repeated polls", async () => {
    requireApiPermission.mockResolvedValue({
      ok: true,
      ctx: { authKind: "session", session: { user: { id: "u1" } } },
    });
    pollRateLimiterCheck.mockReturnValue({
      allowed: false,
      remaining: 0,
      retryAfterSec: 12,
    });

    const res = await POST(
      new Request("http://localhost/api/regs/poll", { method: "POST" }),
    );
    expect(res.status).toBe(429);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("enqueues when allowed", async () => {
    requireApiPermission.mockResolvedValue({
      ok: true,
      ctx: { authKind: "session", session: { user: { id: "u1" } } },
    });
    enqueue.mockResolvedValue({ accepted: true });

    const res = await POST(
      new Request("http://localhost/api/regs/poll", { method: "POST" }),
    );
    expect(res.status).toBe(200);
    expect(enqueue).toHaveBeenCalledWith({
      actionCode: "regs.poll",
      trigger: "manual",
      actorUserId: "u1",
    });
  });
});