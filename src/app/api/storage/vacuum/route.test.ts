import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiPermission = vi.fn();
const enqueue = vi.fn();
const assertSameOrigin = vi.fn();
const limiterCheck = vi.fn();

vi.mock("@/modules/auth/guards", () => ({
  requireApiPermission: (...args: unknown[]) => requireApiPermission(...args),
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: (...args: unknown[]) => assertSameOrigin(...args),
}));

vi.mock("@/lib/rate-limit", () => ({
  storageVacuumRateLimiter: {
    check: (...args: unknown[]) => limiterCheck(...args),
  },
}));

vi.mock("@/modules/jobs/runtime", () => ({
  jobRuntime: {
    enqueue: (...args: unknown[]) => enqueue(...args),
  },
}));

import { POST } from "@/app/api/storage/vacuum/route";
import { DATABASE_VACUUM_CONFIRM } from "@/modules/storage/vacuum/sql";

function post(confirm: unknown) {
  return POST(
    new Request("http://localhost/api/storage/vacuum", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm }),
    }),
  );
}

describe("POST /api/storage/vacuum", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertSameOrigin.mockReturnValue({ ok: true });
    limiterCheck.mockReturnValue({ allowed: true, remaining: 2, retryAfterSec: 0 });
    requireApiPermission.mockResolvedValue({
      ok: true,
      ctx: { authKind: "session", session: { user: { id: "u1" } } },
    });
  });

  it("rejects a confirmation other than СЖАТЬ", async () => {
    const res = await post("удалить");
    expect(res.status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("queues vacuum and returns before the rewrite finishes", async () => {
    enqueue.mockResolvedValue({ accepted: true });
    const res = await post(DATABASE_VACUUM_CONFIRM);
    expect(res.status).toBe(202);
    expect(enqueue).toHaveBeenCalledWith({
      actionCode: "db.vacuum",
      trigger: "manual",
      actorUserId: "u1",
    });
  });

  it("returns 409 when import is still running", async () => {
    enqueue.mockResolvedValue({
      accepted: false,
      reason: "anti-overlap: cdr.import in flight",
    });
    const res = await post(DATABASE_VACUUM_CONFIRM);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/импорта/);
  });
});
