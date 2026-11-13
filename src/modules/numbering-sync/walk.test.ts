import { describe, expect, it } from "vitest";
import { SyncLost } from "@/modules/numbering-sync/errors";
import { runCatalogWalk, type WalkDeps } from "@/modules/numbering-sync/walk";

function page(data: unknown) {
  return { ok: true as const, data };
}

describe("sipout catalog walk", () => {
  it("does not publish when the second city fails", async () => {
    const staged: string[] = [];
    let published = false;
    const deps: WalkDeps = {
      getCities: async () => page({ cities: [{ id: "1" }, { id: "2" }] }),
      freeList: async (cityId) => {
        if (cityId === "2") return { ok: false, error: "обрыв" };
        return page({ cnt: "1", list: [{ did: "74953084480", price: "1" }] });
      },
      connectedList: async () => page({ cnt: "0", list: [] }),
      stillMine: async () => "ok",
      stage: async (dids) => {
        staged.push(...dids);
      },
      publish: async () => {
        published = true;
        return staged.length;
      },
      dropStage: async () => undefined,
      progress: async () => undefined,
    };
    const result = await runCatalogWalk("free", deps);
    expect(result).toMatchObject({ ok: false, reason: "error" });
    expect(published).toBe(false);
    expect(staged).toEqual(["74953084480"]);
  });

  it("collapses the same did from two cities into one staged value before publish", async () => {
    const staged: string[][] = [];
    const deps: WalkDeps = {
      getCities: async () => page({ cities: [{ id: "41" }, { id: "42" }] }),
      freeList: async () =>
        page({
          cnt: "1",
          list: [{ did: "74953084480", price: "222", city_id: "41" }],
        }),
      connectedList: async () => page({ cnt: "0", list: [] }),
      stillMine: async () => "ok",
      stage: async (dids) => {
        staged.push(dids);
      },
      publish: async () => 1,
      dropStage: async () => undefined,
      progress: async () => undefined,
    };
    const result = await runCatalogWalk("free", deps);
    expect(result).toEqual({ ok: true, count: 1 });
    expect(staged).toEqual([["74953084480"], ["74953084480"]]);
  });

  it("does not publish after the lease is lost", async () => {
    let published = false;
    const deps: WalkDeps = {
      getCities: async () => page({ cities: [{ id: "1" }] }),
      freeList: async () => page({ cnt: "0", list: [] }),
      connectedList: async () => page({ cnt: "0", list: [] }),
      stillMine: async () => "lost",
      stage: async () => undefined,
      publish: async () => {
        published = true;
        return 0;
      },
      dropStage: async () => undefined,
      progress: async () => undefined,
    };
    const result = await runCatalogWalk("free", deps);
    expect(result).toMatchObject({ ok: false, reason: "lost" });
    expect(published).toBe(false);
  });

  it("treats a lost publish as unpublished", async () => {
    let dropped = false;
    const deps: WalkDeps = {
      getCities: async () => page({ cities: [] }),
      freeList: async () => page({ cnt: "0", list: [] }),
      connectedList: async () => page({ cnt: "1", list: [{ did: "74953084480" }] }),
      stillMine: async () => "ok",
      stage: async () => undefined,
      publish: async () => {
        throw new SyncLost();
      },
      dropStage: async () => {
        dropped = true;
      },
      progress: async () => undefined,
    };
    const result = await runCatalogWalk("purchased", deps);
    expect(result).toMatchObject({ ok: false, reason: "lost" });
    expect(dropped).toBe(true);
  });

  it("does not call free_list when the city list is empty", async () => {
    let listed = false;
    const deps: WalkDeps = {
      getCities: async () => page({ cities: [] }),
      freeList: async () => {
        listed = true;
        return page({ cnt: "0", list: [] });
      },
      connectedList: async () => page({ cnt: "0", list: [] }),
      stillMine: async () => "ok",
      stage: async () => undefined,
      publish: async () => 0,
      dropStage: async () => undefined,
      progress: async () => undefined,
    };
    const result = await runCatalogWalk("free", deps);
    expect(result.ok).toBe(false);
    expect(listed).toBe(false);
  });
});
