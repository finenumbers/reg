import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst } = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    jobRun: {
      findFirst: (...args: unknown[]) => findFirst(...args),
    },
  },
}));

vi.mock("@/modules/smg/poison", () => ({
  listSmgPoisonEntries: () => [],
}));

import { getSmgStatus } from "@/modules/smg/service";

describe("getSmgStatus", () => {
  beforeEach(() => {
    findFirst.mockReset();
  });

  it("reloads an empty history when a completed import wrote rows", async () => {
    findFirst.mockImplementation(async (args: { where?: { OR?: unknown } }) => {
      if (args.where?.OR) return { id: "job-wrote" };
      return { id: "job-wrote" };
    });
    const status = await getSmgStatus(null, { baselineEmpty: true });
    expect(status).toEqual({
      cursor: "job-wrote",
      changed: true,
      poisonFiles: [],
    });
  });

  it("leaves an empty history in place when the import wrote nothing", async () => {
    findFirst.mockImplementation(async (args: { where?: { OR?: unknown } }) => {
      if (args.where?.OR) return null;
      return { id: "job-empty" };
    });
    const status = await getSmgStatus(null, { baselineEmpty: true });
    expect(status.changed).toBe(false);
    expect(status.cursor).toBe("job-empty");
  });

  it("does not treat an unknown since id as an empty history", async () => {
    findFirst.mockImplementation(async (args: { where?: { id?: string } }) => {
      if (args.where?.id === "missing") return null;
      return { id: "job-wrote" };
    });
    const status = await getSmgStatus("missing", { baselineEmpty: true });
    expect(status.changed).toBe(false);
    expect(status.cursor).toBe("job-wrote");
  });
});
