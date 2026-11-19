import { describe, expect, it } from "vitest";
import { SyncLost } from "@/modules/numbering-sync/errors";
import {
  runSipoutFreeWalk,
  runSipoutPurchasedWalk,
  uniqueDids,
  type WalkDeps,
} from "@/modules/numbering-sync/walk";
import type { SipoutPage } from "@/modules/sipout/client";

const META = { status: 200, attempts: 1, durationMs: 4 };

function page(data: unknown): SipoutPage {
  return { ok: true, data, meta: META };
}

function failed(error: string): SipoutPage {
  return { ok: false, error, meta: META };
}

const COUNTS = { deleted: 0, inserted: 0 };

function deps(over: Partial<WalkDeps> = {}): WalkDeps {
  return {
    getCities: async () => page({ cities: [{ id: "1" }] }),
    freeList: async () => page({ cnt: "0", list: [] }),
    connectedList: async () => page({ cnt: "0", list: [] }),
    stillMine: async () => "ok",
    stage: async () => 0,
    prepare: async () => undefined,
    publish: async () => COUNTS,
    dropStage: async () => undefined,
    progress: async () => undefined,
    log: async () => undefined,
    ...over,
  };
}

describe("sipout source walk", () => {
  it("does not read cities or free numbers when connected_list fails", async () => {
    let published = false;
    let dropped = false;
    let cities = false;
    let listed = false;
    const result = await runSipoutPurchasedWalk(
      deps({
        getCities: async () => {
          cities = true;
          return page({ cities: [{ id: "1" }] });
        },
        freeList: async () => {
          listed = true;
          return page({ cnt: "1", list: [{ did: "74953084480" }] });
        },
        connectedList: async () => failed("обрыв"),
        stage: async () => 1,
        publish: async () => {
          published = true;
          return COUNTS;
        },
        dropStage: async () => {
          dropped = true;
        },
      }),
    );
    expect(result).toMatchObject({ ok: false, reason: "error" });
    expect(cities).toBe(false);
    expect(listed).toBe(false);
    expect(published).toBe(false);
    expect(dropped).toBe(true);
  });

  it("publishes an empty free list after the cities are read", async () => {
    let published = 0;
    let listed = 0;
    const result = await runSipoutFreeWalk(
      deps({
        getCities: async () => page({ cities: [{ id: "41" }] }),
        freeList: async () => {
          listed += 1;
          return page({ cnt: "0", list: [] });
        },
        connectedList: async () => page({ cnt: 0, list: [] }),
        publish: async () => {
          published += 1;
          return COUNTS;
        },
      }),
    );
    expect(result).toEqual({ ok: true, counts: COUNTS });
    expect(listed).toBe(1);
    expect(published).toBe(1);
  });

  it("does not publish when the city list is empty", async () => {
    let listed = false;
    let connected = false;
    let published = false;
    const result = await runSipoutFreeWalk(
      deps({
        getCities: async () => page({ cities: [] }),
        freeList: async () => {
          listed = true;
          return page({ cnt: "0", list: [] });
        },
        connectedList: async () => {
          connected = true;
          return page({ cnt: "0", list: [] });
        },
        publish: async () => {
          published = true;
          return COUNTS;
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(connected).toBe(false);
    expect(listed).toBe(false);
    expect(published).toBe(false);
  });

  it("stages one value when one response repeats a number", async () => {
    const staged: { e164: string; incomingPeriod: string }[][] = [];
    await runSipoutFreeWalk(
      deps({
        freeList: async () =>
          page({
            cnt: "2",
            list: [
              { did: "74953084480", price: "222" },
              { did: "+74953084480", price: "333" },
            ],
          }),
        stage: async (_catalog, rows) => {
          staged.push([...rows]);
          return rows.length;
        },
      }),
    );
    expect(staged[0]).toEqual([{ e164: "74953084480", incomingPeriod: "222" }]);
    expect(uniqueDids(["74953084480", "74953084480"])).toEqual(["74953084480"]);
  });

  it("does not publish after the lease is lost", async () => {
    let published = false;
    const result = await runSipoutPurchasedWalk(
      deps({
        stillMine: async () => "lost",
        publish: async () => {
          published = true;
          return COUNTS;
        },
      }),
    );
    expect(result).toMatchObject({ ok: false, reason: "lost" });
    expect(published).toBe(false);
  });

  it("treats a lost publish as unpublished", async () => {
    let dropped = false;
    const result = await runSipoutPurchasedWalk(
      deps({
        publish: async () => {
          throw new SyncLost();
        },
        dropStage: async () => {
          dropped = true;
        },
      }),
    );
    expect(result).toMatchObject({ ok: false, reason: "lost" });
    expect(dropped).toBe(true);
  });
});
