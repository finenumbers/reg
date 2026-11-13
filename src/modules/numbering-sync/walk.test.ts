import { describe, expect, it } from "vitest";
import { SyncLost } from "@/modules/numbering-sync/errors";
import { runSourceWalk, uniqueDids, type WalkDeps } from "@/modules/numbering-sync/walk";
import type { SipoutPage } from "@/modules/sipout/client";

const META = { status: 200, attempts: 1, durationMs: 4 };

function page(data: unknown): SipoutPage {
  return { ok: true, data, meta: META };
}

function failed(error: string): SipoutPage {
  return { ok: false, error, meta: META };
}

const COUNTS = {
  deletedFree: 0,
  insertedFree: 0,
  deletedPurchased: 0,
  insertedPurchased: 0,
};

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
  it("does not publish when connected_list fails after a free list", async () => {
    let published = false;
    let dropped = false;
    const result = await runSourceWalk(
      deps({
        freeList: async () => page({ cnt: "1", list: [{ did: "74953084480" }] }),
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
    expect(published).toBe(false);
    expect(dropped).toBe(true);
  });

  it("publishes once when both lists are complete and empty", async () => {
    let published = 0;
    let listed = 0;
    const result = await runSourceWalk(
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

  it("does not call free_list when the city list is empty", async () => {
    let listed = false;
    let connected = false;
    let published = false;
    const result = await runSourceWalk(
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
    expect(listed).toBe(false);
    expect(connected).toBe(false);
    expect(published).toBe(false);
  });

  it("stages one value when one response repeats a number", async () => {
    const staged: string[][] = [];
    await runSourceWalk(
      deps({
        freeList: async () =>
          page({
            cnt: "2",
            list: [{ did: "74953084480" }, { did: "+74953084480" }],
          }),
        stage: async (_catalog, dids) => {
          staged.push([...dids]);
          return dids.length;
        },
      }),
    );
    expect(staged[0]).toEqual(["74953084480"]);
    expect(uniqueDids(["74953084480", "74953084480"])).toEqual(["74953084480"]);
  });

  it("does not publish after the lease is lost", async () => {
    let published = false;
    const result = await runSourceWalk(
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
    const result = await runSourceWalk(
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
