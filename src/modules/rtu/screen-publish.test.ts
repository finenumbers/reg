import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  enqueueScreenPublish,
  liveScreenStamps,
  publishedScreenStamps,
  resetRtuScreenPublishForTests,
  runScreenPublish,
  screenStampsMatch,
  screenSwapFresh,
  type ScreenPublishDeps,
  type ScreenStamps,
  type StampRow,
} from "@/modules/rtu/screen-publish";

const synced = new Date("2026-11-08T00:00:00.000Z");

function stamp(over: Partial<StampRow> = {}): StampRow {
  return {
    phones_synced_at: synced,
    tariff_generation: 3,
    supplier_revision: 1,
    published_supplier_revision: 1,
    published_did_hash: "hash",
    published_phones_synced_at: synced,
    published_tariff_generation: 3,
    mask_generation: 4,
    published_mask_generation: 4,
    published: true,
    needs_publish: false,
    catalog_revision: 4,
    did_generation: 2,
    did_hash: "hash",
    ...over,
  };
}

function deps(over: Partial<ScreenPublishDeps> = {}): ScreenPublishDeps & {
  built: string[];
  swapped: string[];
  dropped: string[];
} {
  const built: string[] = [];
  const swapped: string[] = [];
  const dropped: string[] = [];
  return {
    built,
    swapped,
    dropped,
    read: async () => stamp(),
    markDirty: async () => undefined,
    clearDirty: async () => undefined,
    build: async (token) => {
      built.push(token);
    },
    swap: async (token) => {
      swapped.push(token);
    },
    dropBuild: async (token) => {
      dropped.push(token);
    },
    token: () => "ab12cd34",
    ...over,
  };
}

describe("screen stamps", () => {
  const live: ScreenStamps = {
    phonesSyncedAt: synced,
    supplierRevision: 1,
    didHash: "hash",
    didGeneration: 2,
    tariffGeneration: 3,
    maskGeneration: 4,
  };

  it("matches the stored content hash and ignores a new DID generation", () => {
    const row = stamp();
    expect(screenStampsMatch(publishedScreenStamps(row), liveScreenStamps(row))).toBe(
      true,
    );
    expect(screenStampsMatch(live, { ...live, didGeneration: 9 })).toBe(true);
    expect(screenStampsMatch(live, { ...live, didHash: "other", didGeneration: 9 })).toBe(
      false,
    );
    expect(screenSwapFresh(live, { ...live, didHash: "", didGeneration: 2 })).toBe(true);
    expect(screenSwapFresh(live, { ...live, didGeneration: 3 })).toBe(false);
    expect(screenSwapFresh(live, { ...live, supplierRevision: 2 })).toBe(false);
    expect(screenStampsMatch(live, { ...live, maskGeneration: 5 })).toBe(false);
    expect(screenSwapFresh(live, { ...live, maskGeneration: 5 })).toBe(false);
  });

  it("keeps the on-switch index through the screen swap", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/modules/rtu/screen-publish.ts"),
      "utf8",
    );
    expect(source).toContain(
      'CREATE INDEX "rtu_screen_b_${token}_on_switch_idx" ON "${table}" ("number", "id") INCLUDE ("client", "supplier", "pstnKey") WHERE NOT missing',
    );
    expect(source).toContain(
      'rename("rtu_screen_on_switch_idx", `rtu_screen_on_switch_idx_${safe}`)',
    );
    expect(source).toContain(
      'rename(`rtu_screen_b_${safe}_on_switch_idx`, "rtu_screen_on_switch_idx")',
    );
    expect(source).toContain("rtu.screen.marking_supplier_sync_failed");
    expect(source.indexOf("markingSupplierSyncSql()")).toBeGreaterThan(
      source.indexOf("ALTER TABLE"),
    );
  });

  it("writes the mask generation seen at the start of the build", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/modules/rtu/screen-publish.ts"),
      "utf8",
    );
    expect(source).toContain('"maskGeneration" = ${observed.maskGeneration}');
    expect(source).toContain("FROM number_mask_import_state WHERE id = 1");
  });
});

describe("runScreenPublish", () => {
  beforeEach(() => {
    resetRtuScreenPublishForTests();
  });

  it("skips the build when the published stamps already match", async () => {
    let cleared = 0;
    const harness = deps({
      read: async () => stamp({ needs_publish: true }),
      clearDirty: async () => {
        cleared += 1;
      },
    });
    const result = await runScreenPublish(harness);
    expect(result).toEqual({ published: true });
    expect(harness.built).toEqual([]);
    expect(cleared).toBe(1);
  });

  it("retries a stale swap and then publishes the later build", async () => {
    let swaps = 0;
    const harness = deps({
      read: async () => stamp({ published: false, published_supplier_revision: 0 }),
      swap: async (token) => {
        swaps += 1;
        if (swaps === 1) throw new Error("screen stamps changed");
        harness.swapped.push(token);
      },
    });
    const result = await runScreenPublish(harness);
    expect(result).toEqual({ published: true });
    expect(harness.built).toHaveLength(2);
    expect(harness.dropped).toEqual(["ab12cd34"]);
    expect(harness.swapped).toEqual(["ab12cd34"]);
  });

  it("retries a lock timeout", async () => {
    let swaps = 0;
    const harness = deps({
      read: async () => stamp({ published: false }),
      swap: async (token) => {
        swaps += 1;
        if (swaps === 1) throw new Error("canceling statement due to lock timeout");
        harness.swapped.push(token);
      },
    });
    const result = await runScreenPublish(harness);
    expect(result).toEqual({ published: true });
    expect(harness.swapped).toEqual(["ab12cd34"]);
    expect(harness.dropped).toEqual(["ab12cd34"]);
  });

  it("returns unpublished on a SQL error and drops the build table once", async () => {
    let builds = 0;
    const harness = deps({
      read: async () => stamp({ published: false }),
      build: async () => {
        builds += 1;
        throw new Error("relation rtu_screen does not exist");
      },
    });
    const result = await runScreenPublish(harness);
    expect(result).toEqual({ published: false });
    expect(builds).toBe(1);
    expect(harness.dropped).toEqual(["ab12cd34"]);
    expect(harness.swapped).toEqual([]);
  });

  it("does not publish a build whose supplier revision went stale", async () => {
    let reads = 0;
    const harness = deps({
      read: async () => {
        reads += 1;
        if (reads === 1) {
          return stamp({ supplier_revision: 2, published_supplier_revision: 1 });
        }
        return stamp({ supplier_revision: 2, published_supplier_revision: 2 });
      },
      swap: async () => {
        throw new Error("screen stamps changed");
      },
    });
    const result = await runScreenPublish(harness);
    expect(result).toEqual({ published: true });
    expect(harness.built).toEqual(["ab12cd34"]);
    expect(harness.swapped).toEqual([]);
    expect(harness.dropped).toEqual(["ab12cd34"]);
  });

  it("runs a queued publish only after the previous one has read its stamps", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    const harness = deps({
      read: async () => {
        reads += 1;
        if (reads === 1) await gate;
        return stamp();
      },
    });
    const first = enqueueScreenPublish(harness);
    await Promise.resolve();
    const second = enqueueScreenPublish(harness);
    expect(reads).toBe(1);
    release();
    await expect(first).resolves.toEqual({ published: true });
    await expect(second).resolves.toEqual({ published: true });
    expect(reads).toBe(2);
    expect(harness.built).toEqual([]);
  });
});
