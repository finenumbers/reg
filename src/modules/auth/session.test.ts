import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const findUser = vi.fn();
const getUserAuthz = vi.fn();
const authenticateApiKey = vi.fn();
const headerBag = vi.fn(() => new Headers());

vi.mock("next/headers", () => ({
  headers: () => headerBag(),
}));

vi.mock("@/modules/auth/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSession(...args),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => findUser(...args),
    },
  },
}));

vi.mock("@/modules/rbac/service", () => ({
  getUserAuthz: (...args: unknown[]) => getUserAuthz(...args),
}));

vi.mock("@/modules/api-keys/service", () => ({
  authenticateApiKey: (...args: unknown[]) => authenticateApiKey(...args),
}));

import { apiKeyFailureRateLimiter, apiKeyRateLimiter } from "@/lib/rate-limit";
import { AuthError } from "@/modules/auth/errors";
import { requireApiAuthz } from "@/modules/auth/session";

const FAIL_KEY = "api-key-fail:203.0.113.8";

function sessionHeaders(): Headers {
  return new Headers({
    "x-real-ip": "203.0.113.8",
    authorization: "Bearer reg_not-a-valid-secret",
  });
}

function primeSession(): void {
  getSession.mockResolvedValue({ user: { id: "u1", username: "admin" } });
  findUser.mockResolvedValue({ isActive: true, username: "admin" });
  getUserAuthz.mockResolvedValue({
    userId: "u1",
    roles: ["admin"],
    permissions: ["regs:read", "settings:write"],
  });
}

describe("requireApiAuthz", () => {
  beforeEach(() => {
    getSession.mockReset();
    findUser.mockReset();
    getUserAuthz.mockReset();
    authenticateApiKey.mockReset();
    headerBag.mockReset();
    headerBag.mockImplementation(sessionHeaders);
    apiKeyFailureRateLimiter.reset();
    apiKeyRateLimiter.reset();
    primeSession();
  });

  it("uses the session when the reg_ secret is not a key", async () => {
    authenticateApiKey.mockResolvedValue(null);
    const ctx = await requireApiAuthz();
    expect(ctx.authKind).toBe("session");
    expect(ctx.authz.permissions).toContain("settings:write");
  });

  it("does not record a failure for a valid key", async () => {
    authenticateApiKey.mockResolvedValue({
      id: "k1",
      name: "reader",
      permissions: ["regs:read", "phones:read"],
    });
    for (let i = 0; i < 12; i += 1) {
      const ctx = await requireApiAuthz();
      expect(ctx.authKind).toBe("api_key");
    }
    expect(apiKeyFailureRateLimiter.isBlocked(FAIL_KEY)).toBe(false);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("returns 429 for a valid key over its own limit and does not use the session", async () => {
    authenticateApiKey.mockResolvedValue({
      id: "k1",
      name: "reader",
      permissions: ["regs:read"],
    });
    for (let i = 0; i < 10_000; i += 1) apiKeyRateLimiter.check("api-key:k1");
    await expect(requireApiAuthz()).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("stops guessing before the database once the IP is blocked, and keeps a live session", async () => {
    for (let i = 0; i < 10; i += 1) apiKeyFailureRateLimiter.check(FAIL_KEY);
    authenticateApiKey.mockResolvedValue(null);
    const ctx = await requireApiAuthz();
    expect(ctx.authKind).toBe("session");
    expect(authenticateApiKey).not.toHaveBeenCalled();
  });

  it("rejects a blocked IP that has no session", async () => {
    for (let i = 0; i < 10; i += 1) apiKeyFailureRateLimiter.check(FAIL_KEY);
    getSession.mockResolvedValue(null);
    await expect(requireApiAuthz()).rejects.toBeInstanceOf(AuthError);
    await expect(requireApiAuthz()).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(authenticateApiKey).not.toHaveBeenCalled();
  });
});
