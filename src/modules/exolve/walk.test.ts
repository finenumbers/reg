import { describe, expect, it } from "vitest";
import { DUPLICATE_NUMBER } from "@/modules/exolve/parse";
import {
  FREE_OFFSET_MAX,
  FREE_LIMIT,
  nextFreeOffset,
  purchasedBody,
  freeBody,
} from "@/modules/exolve/url";
import {
  CANCELLED,
  FREE_OFFSET_TOO_FAR,
  PURCHASED_CHANGED,
  SUM_MISMATCH,
  runExolveWalk,
  type Directory,
  type ExolveFreeRow,
  type ExolveWalkDeps,
  type PurchasedFilter,
} from "@/modules/exolve/walk";

const directory: Directory = {
  types: [
    { typeId: 1104, typeName: "DEF", categories: [{ categoryId: 10000 }] },
    { typeId: 1106, typeName: "KDU", categories: [{ categoryId: 10002 }] },
  ],
  regions: [
    { regionId: 10084, parentRegionId: null },
    { regionId: 10230, parentRegionId: 10084 },
  ],
};

function did(index: number): string {
  return `79${String(index).padStart(9, "0")}`;
}

function keyOf(filter: PurchasedFilter): string {
  if (filter.kind === "all") return "all";
  if (filter.kind === "type") return `type:${filter.typeName}`;
  if (filter.kind === "category") return `category:${filter.typeName}:${filter.categoryId}`;
  return `region:${filter.typeName}:${filter.categoryId}:${filter.regionId}`;
}

type Page = { total: number; rows: string[] };

function harness(input: {
  purchased: (filter: PurchasedFilter, offset: number) => Page | { error: string };
  recount?: () => number;
  directory?: Directory;
  free?: (cell: { typeId: number; regionId: number }, offset: number) => ExolveFreeRow[];
  freeOffsetMax?: number;
}): {
  deps: ExolveWalkDeps;
  bought: string[];
  prices: Map<string, string>;
  purchasedKeys: string[];
  purchasedOffsets: number[];
  regionCalls: string[];
  freeCalls: { typeId: number; regionId: number; offset: number }[];
  dropped: { count: number };
  recounts: { count: number };
} {
  const bought: string[] = [];
  const boughtSet = new Set<string>();
  const prices = new Map<string, string>();
  const purchasedKeys: string[] = [];
  const purchasedOffsets: number[] = [];
  const regionCalls: string[] = [];
  const freeCalls: { typeId: number; regionId: number; offset: number }[] = [];
  const dropped = { count: 0 };
  const recounts = { count: 0 };
  const deps: ExolveWalkDeps = {
    beat: async () => "run",
    purchased: async (filter, offset) => {
      purchasedKeys.push(keyOf(filter));
      purchasedOffsets.push(offset);
      if (filter.kind === "region") regionCalls.push(`${filter.regionId}`);
      const page = input.purchased(filter, offset);
      if ("error" in page) return { ok: false, error: page.error };
      return { ok: true, total: page.total, rows: page.rows };
    },
    recount: async () => {
      recounts.count += 1;
      return { ok: true, total: input.recount?.() ?? 0 };
    },
    directory: async () => ({ ok: true, directory: input.directory ?? directory }),
    free: async (cell, offset) => {
      freeCalls.push({ typeId: cell.typeId, regionId: cell.regionId, offset });
      const rows = input.free?.(cell, offset) ?? [];
      return { ok: true, rows };
    },
    stagePurchased: async (dids) => {
      const seen = new Set<string>();
      for (const id of dids) {
        if (seen.has(id) || boughtSet.has(id)) throw new Error(DUPLICATE_NUMBER);
        seen.add(id);
      }
      for (const id of dids) {
        seen.add(id);
        boughtSet.add(id);
        bought.push(id);
      }
    },
    dropPurchased: async () => {
      dropped.count += 1;
      bought.length = 0;
      boughtSet.clear();
    },
    stageFree: async (rows) => {
      let inserted = 0;
      let skipped = 0;
      for (const row of rows) {
        if (prices.has(row.e164)) skipped += 1;
        else {
          prices.set(row.e164, row.incomingPurchase);
          inserted += 1;
        }
      }
      return { inserted, skipped };
    },
    freeOffsetMax: input.freeOffsetMax,
  };
  return { deps, bought, prices, purchasedKeys, purchasedOffsets, regionCalls, freeCalls, dropped, recounts };
}

describe("Exolve walk", () => {
  it("grows the purchased offset by the rows received and then reads every free cell", async () => {
    const run = harness({
      purchased: (filter, offset) => {
        if (filter.kind !== "all") throw new Error(keyOf(filter));
        if (offset === 0) return { total: 3, rows: [did(1), did(2)] };
        if (offset === 2) return { total: 3, rows: [did(3)] };
        throw new Error(String(offset));
      },
      recount: () => 3,
      free: () => [],
    });
    const result = await runExolveWalk(run.deps);
    expect(result).toEqual({ ok: true, free: 0, purchased: 3 });
    expect(run.purchasedOffsets).toEqual([0, 2]);
    expect(run.dropped.count).toBe(0);
    expect(run.recounts.count).toBe(1);
    expect(run.freeCalls.map((call) => [call.typeId, call.regionId])).toEqual([
      [1104, 10084],
      [1104, 10230],
      [1106, 10084],
    ]);
    expect(run.bought).toEqual([did(1), did(2), did(3)]);
  });

  it("treats a zero total as a complete empty list and does not split", async () => {
    const run = harness({
      purchased: (_filter, offset) => {
        if (offset !== 0) throw new Error(String(offset));
        return { total: 0, rows: [] };
      },
      recount: () => 0,
    });
    const result = await runExolveWalk(run.deps);
    expect(result.ok).toBe(true);
    expect(run.purchasedKeys).toEqual(["all"]);
    expect(run.dropped.count).toBe(0);
    expect(run.freeCalls).toHaveLength(3);
  });

  it("does not open the directory when the purchased list fails", async () => {
    let directories = 0;
    const run = harness({
      purchased: () => ({ error: "Площадка не ответила." }),
    });
    run.deps.directory = async () => {
      directories += 1;
      return { ok: true, directory };
    };
    const result = await runExolveWalk(run.deps);
    expect(result.ok).toBe(false);
    expect(directories).toBe(0);
    expect(run.freeCalls).toHaveLength(0);
  });

  it("re-reads by type after an empty page and checks the recount", async () => {
    const run = harness({
      purchased: (filter, offset) => {
        if (filter.kind === "all") {
          if (offset === 0) return { total: 2, rows: [did(1)] };
          return { total: 2, rows: [] };
        }
        if (filter.kind === "type" && filter.typeName === "DEF") {
          return { total: 2, rows: [did(1), did(2)] };
        }
        if (filter.kind === "type" && filter.typeName === "KDU") return { total: 0, rows: [] };
        throw new Error(keyOf(filter));
      },
      recount: () => 2,
    });
    const result = await runExolveWalk(run.deps);
    expect(result).toEqual({ ok: true, free: 0, purchased: 2 });
    expect(run.dropped.count).toBe(1);
    expect(run.bought).toEqual([did(1), did(2)]);
    expect(run.regionCalls).toEqual([]);
  });

  it("does not read leaves when the region sum is below the parent", async () => {
    const run = harness({
      purchased: (filter, offset) => {
        if (filter.kind === "all") {
          if (offset === 0) return { total: 2, rows: [did(1)] };
          return { total: 2, rows: [] };
        }
        if (filter.kind === "type") {
          if (filter.typeName === "KDU") return { total: 0, rows: [] };
          if (offset === 0) return { total: 2, rows: [] };
        }
        if (filter.kind === "category") {
          if (offset === 0) return { total: 2, rows: [] };
        }
        if (filter.kind === "region") return { total: 0, rows: [] };
        throw new Error(keyOf(filter));
      },
    });
    const result = await runExolveWalk(run.deps);
    expect(result).toEqual({ ok: false, reason: "error", error: SUM_MISMATCH });
    expect(run.regionCalls).toEqual(["10084", "10230"]);
    expect(run.freeCalls).toHaveLength(0);
  });

  it("keeps only the leaf rows when every region sums above the parent", async () => {
    const run = harness({
      directory: {
        types: [{ typeId: 1104, typeName: "DEF", categories: [{ categoryId: 10000 }] }],
        regions: directory.regions,
      },
      purchased: (filter) => {
        if (filter.kind === "all") return { total: 1, rows: [] };
        if (filter.kind === "type") return { total: 1, rows: [] };
        if (filter.kind === "category") return { total: 1, rows: [] };
        if (filter.kind === "region" && filter.regionId === 10084) {
          return { total: 1, rows: [did(1)] };
        }
        if (filter.kind === "region" && filter.regionId === 10230) {
          return { total: 1, rows: [did(2)] };
        }
        throw new Error(keyOf(filter));
      },
      recount: () => 1,
    });
    const result = await runExolveWalk(run.deps);
    expect(result).toEqual({ ok: true, free: 0, purchased: 1 });
    expect(run.bought).toEqual([did(2)]);
    expect(run.regionCalls.filter((id) => id === "10084")).toHaveLength(1);
    expect(run.regionCalls.filter((id) => id === "10230")).toHaveLength(2);
  });

  it("asks KDU for Russia only", async () => {
    const run = harness({
      directory: {
        types: [{ typeId: 1106, typeName: "KDU", categories: [{ categoryId: 10002 }] }],
        regions: directory.regions,
      },
      purchased: (filter) => {
        if (filter.kind === "all") return { total: 1, rows: [] };
        if (filter.kind === "type") return { total: 1, rows: [] };
        if (filter.kind === "category") return { total: 1, rows: [] };
        if (filter.kind === "region" && filter.regionId === 10084) {
          return { total: 1, rows: [did(8)] };
        }
        throw new Error(keyOf(filter));
      },
      recount: () => 1,
    });
    const result = await runExolveWalk(run.deps);
    expect(result.ok).toBe(true);
    expect(run.regionCalls).toEqual(["10084"]);
    expect(run.bought).toEqual([did(8)]);
  });

  it("fails the walk when the same purchased number appears in two types", async () => {
    const run = harness({
      purchased: (filter) => {
        if (filter.kind === "all") return { total: 2, rows: [] };
        if (filter.kind === "type") return { total: 1, rows: [did(1)] };
        throw new Error(keyOf(filter));
      },
    });
    const result = await runExolveWalk(run.deps);
    expect(result).toEqual({ ok: false, reason: "error", error: DUPLICATE_NUMBER });
    expect(run.freeCalls).toHaveLength(0);
  });

  it("stops when the recount total moved and does not stage those rows", async () => {
    const run = harness({
      purchased: () => ({ total: 1, rows: [did(1)] }),
      recount: () => 2,
    });
    const result = await runExolveWalk(run.deps);
    expect(result).toEqual({ ok: false, reason: "error", error: PURCHASED_CHANGED });
    expect(run.recounts.count).toBe(1);
    expect(run.freeCalls).toHaveLength(0);
    expect(run.bought).toEqual([did(1)]);
  });

  it("ends a free cell on a short page and keeps the first price of a later cell", async () => {
    const run = harness({
      purchased: () => ({ total: 0, rows: [] }),
      directory: {
        types: [{ typeId: 1104, typeName: "DEF", categories: [{ categoryId: 10000 }] }],
        regions: [
          { regionId: 10084, parentRegionId: null },
          { regionId: 10230, parentRegionId: null },
        ],
      },
      free: (cell) => [
        {
          e164: did(1),
          incomingPurchase: cell.regionId === 10084 ? "100" : "999",
          incomingPeriod: "",
        },
      ],
    });
    const result = await runExolveWalk(run.deps);
    expect(result).toEqual({ ok: true, free: 1, purchased: 0 });
    expect(run.freeCalls).toHaveLength(2);
    expect(run.prices.get(did(1))).toBe("100");
  });

  it("fails a repeated number inside one free cell", async () => {
    const run = harness({
      purchased: () => ({ total: 0, rows: [] }),
      directory: {
        types: [{ typeId: 1104, typeName: "DEF", categories: [{ categoryId: 10000 }] }],
        regions: [{ regionId: 10084, parentRegionId: null }],
      },
      free: (_cell, offset) => {
        if (offset === 0) {
          return Array.from({ length: FREE_LIMIT }, (_, index) => ({
            e164: did(index + 1),
            incomingPurchase: "",
            incomingPeriod: "",
          }));
        }
        return [{ e164: did(1), incomingPurchase: "", incomingPeriod: "" }];
      },
    });
    const result = await runExolveWalk(run.deps);
    expect(result).toEqual({ ok: false, reason: "error", error: DUPLICATE_NUMBER });
  });

  it("stops a free cell that would pass the offset ceiling", async () => {
    let serial = 0;
    const run = harness({
      purchased: () => ({ total: 0, rows: [] }),
      directory: {
        types: [{ typeId: 1104, typeName: "DEF", categories: [{ categoryId: 10000 }] }],
        regions: [{ regionId: 10084, parentRegionId: null }],
      },
      freeOffsetMax: 20,
      free: () =>
        Array.from({ length: FREE_LIMIT }, () => {
          serial += 1;
          return { e164: did(serial), incomingPurchase: "", incomingPeriod: "" };
        }),
    });
    const result = await runExolveWalk(run.deps);
    expect(result).toEqual({ ok: false, reason: "error", error: FREE_OFFSET_TOO_FAR });
    expect(run.freeCalls.map((call) => call.offset)).toEqual([0, 10, 20]);
  });

  it("does not publish when the directory has no free cells", async () => {
    const run = harness({
      purchased: () => ({ total: 0, rows: [] }),
      directory: { types: [], regions: [] },
    });
    const result = await runExolveWalk(run.deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("нет ячеек");
    expect(run.freeCalls).toHaveLength(0);
  });

  it("returns a cancel without reading the next page", async () => {
    let beats = 0;
    const run = harness({
      purchased: () => ({ total: 5, rows: [did(1)] }),
    });
    run.deps.beat = async () => {
      beats += 1;
      return beats > 2 ? "cancel" : "run";
    };
    const result = await runExolveWalk(run.deps);
    expect(result).toEqual({ ok: false, reason: "cancelled", error: CANCELLED });
  });
});

describe("Exolve request bodies", () => {
  it("sends only limit and offset for the unfiltered purchased list", () => {
    expect(purchasedBody({ kind: "all" }, 0)).toEqual({ limit: 1000, offset: 0 });
    const layered = purchasedBody(
      { kind: "region", typeName: "DEF", categoryId: 10000, regionId: 10230 },
      1000,
    );
    expect(layered).toEqual({
      limit: 1000,
      offset: 1000,
      type_name: "DEF",
      category_id: 10000,
      region_id: 10230,
    });
    expect(layered && "application_uuid" in layered).toBe(false);
  });

  it("asks GetFree for one cell in order, without a mask", () => {
    const body = freeBody({ typeId: 1104, categoryId: 10000, regionId: 10230 }, 10);
    expect(body).toEqual({
      type_id: 1104,
      region_id: 10230,
      category_id: 10000,
      random: false,
      limit: 10,
      offset: 10,
    });
    expect(body && "mask" in body).toBe(false);
    expect(nextFreeOffset(FREE_OFFSET_MAX, 10)).toBeNull();
    expect(nextFreeOffset(FREE_OFFSET_MAX - 10, 10)).toBe(FREE_OFFSET_MAX);
  });
});
