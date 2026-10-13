import { beforeEach, describe, expect, it, vi } from "vitest";

const { count, findMany, groupBy, queryRaw } = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
  groupBy: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    smgCdrRecord: {
      count: (...args: unknown[]) => count(...args),
      findMany: (...args: unknown[]) => findMany(...args),
      groupBy: (...args: unknown[]) => groupBy(...args),
    },
  },
}));

vi.mock("@/modules/smg/poison", () => ({
  listSmgPoisonEntries: () => [],
}));

vi.mock("@/modules/storage/vacuum/gate", () => ({
  isDatabaseVacuumActive: () => false,
}));

import { listSmgCalls, listSmgFacets } from "@/modules/smg/service";

const OCTOBER = {
  disconnectTime: { gte: "2026-10-01 00:00:00", lt: "2026-11-01 00:00:00" },
};

describe("listSmgCalls", () => {
  beforeEach(() => {
    count.mockReset();
    findMany.mockReset();
    groupBy.mockReset();
    queryRaw.mockReset();
    count.mockResolvedValue(0);
    findMany.mockResolvedValue([]);
    queryRaw.mockResolvedValue([]);
    groupBy.mockResolvedValue([]);
  });

  it("keeps the requested gateway and skips the menu recount", async () => {
    const result = await listSmgCalls({
      month: "2026-10",
      device: "kazan",
      includeDevices: false,
      filters: { deviceSign: ["other"], duration: ["1"] },
    });

    expect(groupBy).not.toHaveBeenCalled();
    expect(result.device).toBe("kazan");
    expect(result.devices).toBeNull();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ AND: [OCTOBER, { deviceSign: "kazan" }] }, { OR: [{ duration: "1" }] }],
        },
      }),
    );
  });

  it("recounts on the first open and selects the first listed gateway", async () => {
    groupBy.mockResolvedValue([
      { deviceSign: "kazan", _count: { id: 2 } },
      { deviceSign: "mts", _count: { id: 9 } },
    ]);

    const result = await listSmgCalls({ month: "2026-10" });

    expect(result.device).toBe("kazan");
    expect(result.devices).toEqual([
      { sign: "kazan", count: 2 },
      { sign: "mts", count: 9 },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [OCTOBER, { deviceSign: "kazan" }] },
      }),
    );
  });

  it("switches to the first gateway when a recounted month no longer has the node", async () => {
    groupBy.mockResolvedValue([{ deviceSign: "kazan", _count: { id: 2 } }]);

    const result = await listSmgCalls({
      month: "2026-10",
      device: "mts",
      includeDevices: true,
    });

    expect(result.device).toBe("kazan");
    expect(result.devices).toEqual([{ sign: "kazan", count: 2 }]);
  });

  it("matches nothing when the recounted month has no gateways", async () => {
    const result = await listSmgCalls({
      month: "2026-10",
      device: "mts",
      includeDevices: true,
    });

    expect(result.device).toBe("");
    expect(result.devices).toEqual([]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [OCTOBER, { id: "" }] },
      }),
    );
  });

  it("does not recount gateways or months while the next page loads", async () => {
    await listSmgCalls({
      month: "2026-10",
      device: "mts",
      page: 2,
    });

    expect(groupBy).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe("listSmgFacets", () => {
  beforeEach(() => {
    groupBy.mockReset();
    groupBy.mockResolvedValue([]);
  });

  it("reads the requested gateway and drops a node column filter", async () => {
    await listSmgFacets({
      column: "incomingIp",
      month: "2026-10",
      device: "mts",
      filters: { deviceSign: ["other"], incomingIp: ["10.0.0.1"] },
    });

    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["incomingIp"],
        where: { AND: [OCTOBER, { deviceSign: "mts" }] },
      }),
    );
  });

  it("does not substitute another gateway", async () => {
    await listSmgFacets({
      column: "incomingIp",
      month: "2026-10",
      device: "nope",
    });

    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [OCTOBER, { deviceSign: "nope" }] },
      }),
    );
  });

  it("returns an empty facet list when the gateway is blank", async () => {
    const result = await listSmgFacets({
      column: "incomingIp",
      month: "2026-10",
      device: "  ",
    });

    expect(result).toEqual({ items: [], truncated: false });
    expect(groupBy).not.toHaveBeenCalled();
  });
});
