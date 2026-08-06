import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findUniqueUser,
  countUser,
  createUser,
  createAccount,
  transaction,
  findUniqueRole,
  findUniqueUserRole,
  createUserRole,
  createAuditLog,
} = vi.hoisted(() => ({
  findUniqueUser: vi.fn(),
  countUser: vi.fn(),
  createUser: vi.fn(),
  createAccount: vi.fn(),
  transaction: vi.fn(),
  findUniqueRole: vi.fn(),
  findUniqueUserRole: vi.fn(),
  createUserRole: vi.fn(),
  createAuditLog: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: findUniqueUser,
      count: countUser,
      create: createUser,
    },
    account: {
      create: createAccount,
    },
    role: {
      findUnique: findUniqueRole,
    },
    userRole: {
      findUnique: findUniqueUserRole,
      create: createUserRole,
    },
    auditLog: {
      create: createAuditLog,
    },
    $transaction: transaction,
  },
}));

vi.mock("better-auth/crypto", () => ({
  hashPassword: vi.fn(async () => "hashed-password"),
}));

import { bootstrapAdminIfEmpty } from "@/modules/users/bootstrap";

describe("bootstrapAdminIfEmpty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_USERNAME = "admin";
    process.env.ADMIN_PASSWORD = "secure-password";
    delete process.env.ADMIN_DISPLAY_NAME;

    findUniqueRole.mockResolvedValue({ id: "role-admin", name: "admin" });
    findUniqueUserRole.mockResolvedValue(null);
    createUserRole.mockResolvedValue({ id: "ur-1" });
    createAuditLog.mockResolvedValue({ id: "audit-1" });
    transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: { create: createUser },
        account: { create: createAccount },
      };
      return fn(tx);
    });
  });

  it("skips when ADMIN env is missing", async () => {
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD;
    const result = await bootstrapAdminIfEmpty();
    expect(result).toEqual({
      status: "skipped",
      reason: "ADMIN_USERNAME / ADMIN_PASSWORD not set",
    });
  });

  it("creates admin when users table is empty", async () => {
    findUniqueUser.mockResolvedValue(null);
    countUser.mockResolvedValue(0);
    createUser.mockResolvedValue({});
    createAccount.mockResolvedValue({});

    const result = await bootstrapAdminIfEmpty();

    expect(result.status).toBe("created");
    if (result.status === "created") {
      expect(result.username).toBe("admin");
    }
    expect(createUser).toHaveBeenCalledOnce();
    expect(createAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerId: "credential",
          password: "hashed-password",
        }),
      }),
    );
    expect(createUserRole).toHaveBeenCalledOnce();
  });

  it("is idempotent when admin username already exists", async () => {
    findUniqueUser.mockResolvedValue({ id: "user-1", username: "admin" });
    findUniqueUserRole.mockResolvedValue({ id: "ur-existing" });

    const first = await bootstrapAdminIfEmpty();
    const second = await bootstrapAdminIfEmpty();

    expect(first.status).toBe("exists");
    expect(second.status).toBe("exists");
    expect(createUser).not.toHaveBeenCalled();
    expect(countUser).not.toHaveBeenCalled();
  });

  it("refuses to create bootstrap admin when other users already exist", async () => {
    findUniqueUser.mockResolvedValue(null);
    countUser.mockResolvedValue(2);

    const result = await bootstrapAdminIfEmpty();

    expect(result).toEqual({
      status: "skipped",
      reason:
        "Users already exist and bootstrap username was not found; refusing to create an additional admin",
    });
    expect(createUser).not.toHaveBeenCalled();
  });
});
