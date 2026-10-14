import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const update = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    apiKey: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      update: (...args: unknown[]) => update(...args),
    },
  },
}));

vi.mock("@/modules/audit/service", () => ({
  auditService: { append: vi.fn() },
  AUDIT_ACTIONS: {},
}));

import { hashApiKey } from "@/modules/api-keys/crypto";
import {
  apiKeyEffectivePermissions,
  authenticateApiKey,
} from "@/modules/api-keys/service";

const SECRET = "reg_testkeysecretvalue";

describe("apiKeyEffectivePermissions", () => {
  it("keeps only the read-only scopes, in allowlist order", () => {
    expect(
      apiKeyEffectivePermissions(["settings:write", "phones:read", "regs:read"]),
    ).toEqual(["regs:read", "phones:read"]);
  });

  it("drops a key that has no read scope", () => {
    expect(apiKeyEffectivePermissions(["settings:write", "regs:poll"])).toEqual([]);
  });
});

describe("authenticateApiKey", () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
    update.mockResolvedValue({});
  });

  it("returns the read-only intersection and ignores extra stored permissions", async () => {
    findUnique.mockResolvedValue({
      id: "k1",
      name: "ops",
      enabled: true,
      revokedAt: null,
      keyHash: hashApiKey(SECRET),
      permissions: ["phones:read", "settings:write", "regs:read"],
    });

    await expect(authenticateApiKey(SECRET)).resolves.toEqual({
      id: "k1",
      name: "ops",
      permissions: ["regs:read", "phones:read"],
    });
  });

  it("rejects a key whose stored permissions are outside the read-only set", async () => {
    findUnique.mockResolvedValue({
      id: "k2",
      name: "wide",
      enabled: true,
      revokedAt: null,
      keyHash: hashApiKey(SECRET),
      permissions: ["settings:write"],
    });

    await expect(authenticateApiKey(SECRET)).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});
