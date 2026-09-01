import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compactPrismaError,
  isTransientPrismaError,
  prismaErrorFields,
  withTransientRetry,
} from "@/lib/prisma-transient";

describe("isTransientPrismaError", () => {
  it("matches Prisma and Postgres codes", () => {
    expect(isTransientPrismaError({ code: "P2028", message: "x" })).toBe(true);
    expect(isTransientPrismaError({ code: "P1017", message: "x" })).toBe(true);
    expect(isTransientPrismaError({ meta: { code: "25P02" }, message: "x" })).toBe(
      true,
    );
  });

  it("matches typical messages", () => {
    expect(
      isTransientPrismaError(new Error("Transaction has been aborted.")),
    ).toBe(true);
    expect(
      isTransientPrismaError(new Error("Connection terminated unexpectedly")),
    ).toBe(true);
  });

  it("rejects ordinary errors", () => {
    expect(isTransientPrismaError(new Error("unique constraint"))).toBe(false);
    expect(isTransientPrismaError({ code: "P2002", message: "dup" })).toBe(
      false,
    );
  });
});

describe("compactPrismaError", () => {
  it("skips the Invalid prisma invocation header", () => {
    const message = [
      "Invalid `prisma.cdrRecord.findFirst()` invocation:",
      "",
      "Transaction has been aborted.",
    ].join("\n");
    expect(compactPrismaError({ code: "P2028", message })).toBe(
      "P2028: Transaction has been aborted.",
    );
  });

  it("keeps a short plain message", () => {
    expect(compactPrismaError(new Error("vm down"))).toBe("vm down");
  });
});

describe("prismaErrorFields", () => {
  it("extracts code and meta", () => {
    expect(
      prismaErrorFields({
        message: "fail",
        code: "P2028",
        meta: { code: "25P02" },
      }),
    ).toEqual({
      error: "fail",
      code: "P2028",
      meta: { code: "25P02" },
      cause: null,
    });
  });
});

describe("withTransientRetry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns on a later attempt after a transient error", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ code: "P2028", message: "aborted" })
      .mockResolvedValueOnce("ok");
    await expect(
      withTransientRetry(fn, { attempts: 3, delayMs: 0 }),
    ).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws immediately on a non-transient error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("unique constraint"));
    await expect(withTransientRetry(fn, { delayMs: 0 })).rejects.toThrow(
      "unique constraint",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
