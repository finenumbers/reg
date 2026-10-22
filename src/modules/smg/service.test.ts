import { beforeEach, describe, expect, it, vi } from "vitest";

const { count, findMany, groupBy, queryRaw, traceFindMany } = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
  groupBy: vi.fn(),
  queryRaw: vi.fn(),
  traceFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    smgCdrRecord: {
      count: (...args: unknown[]) => count(...args),
      findMany: (...args: unknown[]) => findMany(...args),
      groupBy: (...args: unknown[]) => groupBy(...args),
    },
    smgCallTrace: {
      findMany: (...args: unknown[]) => traceFindMany(...args),
    },
  },
}));

vi.mock("@/modules/smg/poison", () => ({
  listSmgPoisonEntries: () => [],
}));

vi.mock("@/modules/storage/vacuum/gate", () => ({
  isDatabaseVacuumActive: () => false,
}));

import { AF_CATEGORY, AF_STATUS } from "@/modules/smg-trace/classify";
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
    traceFindMany.mockReset();
    count.mockResolvedValue(0);
    findMany.mockResolvedValue([]);
    queryRaw.mockResolvedValue([]);
    groupBy.mockResolvedValue([]);
    traceFindMany.mockResolvedValue([]);
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

  it("orders by the start stamp when the date chevron is on", async () => {
    await listSmgCalls({
      month: "2026-10",
      device: "mts",
      page: 2,
      setupSort: "desc",
    });

    expect(queryRaw).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ setupTime: "desc" }, { id: "desc" }],
      }),
    );
  });

  it("uses SQL for a start-day filter", async () => {
    await listSmgCalls({
      month: "2026-10",
      device: "mts",
      page: 2,
      filters: { setupDay: ["2026-10-13"] },
    });

    expect(queryRaw).toHaveBeenCalled();
    expect(groupBy).not.toHaveBeenCalled();
  });

  it("filters a ready antifraud label as a stored column", async () => {
    queryRaw.mockResolvedValue([{ ready: true, pending: false }]);
    findMany.mockResolvedValue([
      {
        id: "cdr-1",
        uniqueTag: "1100004f00000001",
        radiusSessionId: "",
        afCategory: AF_CATEGORY.passed,
        afStatus: AF_STATUS.firstTry,
      },
    ]);
    traceFindMany.mockResolvedValue([
      {
        id: "trace-1",
        tagNorm: "1100004f00000001",
        afCategory: AF_CATEGORY.blockedIn,
        afStatus: AF_STATUS.retryIn,
      },
    ]);

    const result = await listSmgCalls({
      month: "2026-10",
      device: "mts",
      includeDevices: false,
      filters: { antifraud: [AF_CATEGORY.passed] },
    });

    expect(count).toHaveBeenCalledWith({
      where: {
        AND: [
          { AND: [OCTOBER, { deviceSign: "mts" }] },
          { OR: [{ afCategory: AF_CATEGORY.passed }] },
        ],
      },
    });
    expect(result.items[0]?.antifraud).toBe(AF_CATEGORY.passed);
    expect(result.items[0]?.antifraudStatus).toBe(AF_STATUS.firstTry);
    const sql = queryRaw.mock.calls.map((call) => rawText(call[0])).join("\n");
    expect(sql).not.toContain("smg_call_traces");
  });

  it("keeps today's join while the month still has an unlabeled row", async () => {
    queryRaw.mockImplementation((query: unknown) => {
      const text = rawText(query);
      if (text.includes("smg_trace_checkpoints")) return [{ ready: true, pending: true }];
      if (text.includes("COUNT")) return [{ n: 0 }];
      return [{ id: "cdr-1" }];
    });

    await listSmgCalls({
      month: "2026-10",
      device: "mts",
      includeDevices: false,
      filters: { antifraud: [AF_CATEGORY.passed] },
    });

    const sql = queryRaw.mock.calls.map((call) => rawText(call[0])).join("\n");
    expect(sql).toContain("smg_call_traces");
    expect(count).not.toHaveBeenCalled();
  });
});

function rawText(query: unknown): string {
  if (Array.isArray(query)) return query.join("?");
  const sql = query as { strings?: string[]; values?: unknown[] };
  if (sql?.strings) return `${sql.strings.join("?")} ${JSON.stringify(sql.values ?? [])}`;
  return "";
}

describe("listSmgFacets", () => {
  beforeEach(() => {
    groupBy.mockReset();
    queryRaw.mockReset();
    groupBy.mockResolvedValue([]);
    queryRaw.mockResolvedValue([]);
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

  it("does not probe antifraud labels for an ordinary column", async () => {
    await listSmgFacets({
      column: "incomingIp",
      month: "2026-10",
      device: "mts",
    });

    expect(queryRaw).not.toHaveBeenCalled();
    expect(groupBy).toHaveBeenCalledTimes(1);
  });

  it("groups a ready antifraud menu with the selected date and without cards", async () => {
    queryRaw.mockImplementation((query: unknown) => {
      const text = rawText(query);
      if (text.includes("smg_trace_checkpoints"))
        return [{ ready: true, pending: false }];
      return [{ value: AF_CATEGORY.passed, count: 4 }];
    });

    const result = await listSmgFacets({
      column: "antifraud",
      month: "2026-10",
      device: "mts",
      filters: { setupDay: ["2026-10-13"], antifraud: [AF_CATEGORY.blockedIn] },
    });

    expect(groupBy).not.toHaveBeenCalled();
    expect(result.items).toEqual([{ value: AF_CATEGORY.passed, count: 4 }]);
    const facetSql = queryRaw.mock.calls
      .map((call) => rawText(call[0]))
      .find((text) => text.includes("GROUP BY"));
    expect(facetSql).toContain("af_category");
    expect(facetSql).toContain("2026-10-13");
    expect(facetSql).not.toContain(AF_CATEGORY.blockedIn);
    expect(facetSql).not.toContain("smg_call_traces");
  });
});
