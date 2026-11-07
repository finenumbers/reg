import { describe, expect, it, vi } from "vitest";
import type { DidCredentials } from "@/modules/did/types";
import {
  acceptPurchasedItems,
  collapseDidSources,
  createPurchasedWalk,
  didSnapshotIsFresh,
  finishPurchasedWalk,
  geographyDidRowId,
  geographyDisplayNumber,
  notePurchasedTotal,
  syncDidSnapshot,
  type DidSnapshotDeps,
  type DidSnapshotState,
  type DidSourceRow,
} from "@/modules/rtu/did-snapshot";
import { geographyMatchKey } from "@/modules/rtu/sql";

const creds: DidCredentials = {
  baseUrl: "http://did-frontend:3000",
  apiToken: "secret",
};

function purchased(msisdn: unknown, provider: unknown = "mcn") {
  return { inventory_kind: "purchased", msisdn, provider_code: provider };
}

describe("geography number identity", () => {
  it("treats 7 and 8 as one full number and keeps a 10-digit number whole", () => {
    expect(geographyMatchKey("79039039900")).toBe("p:9039039900");
    expect(geographyMatchKey("89039039900")).toBe("p:9039039900");
    expect(geographyMatchKey("+7 (903) 903-99-00")).toBe("p:9039039900");
    expect(geographyMatchKey("9039039900")).toBe("p:9039039900");
    expect(geographyMatchKey("12345")).toBe("d:12345");
    expect(geographyMatchKey("12-345")).toBe("d:12345");
    expect(geographyMatchKey("abc")).toBe("e:abc");
    expect(geographyMatchKey("  ")).toBeNull();
    expect(geographyDisplayNumber("89039039900")).toBe("79039039900");
    expect(geographyDisplayNumber("9039039900")).toBe("9039039900");
    expect(geographyDisplayNumber("+7 (903) 903-99-00")).toBe("79039039900");
  });

  it("keeps a long synthetic id inside the PSTN fill limit", () => {
    const key = `d:${"1".repeat(80)}`;
    const id = geographyDidRowId(key);
    expect(id.startsWith("did:")).toBe(true);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id).not.toBe(`did:${key}`);
  });
});

describe("purchased walk", () => {
  it("collapses one full number to the 7-form and one provider", () => {
    const rows = collapseDidSources([
      { msisdn: "89039039900", providerCode: "mcn" },
      { msisdn: "79039039900", providerCode: "mcn" },
      { msisdn: "", providerCode: "sipout" },
    ]);
    expect(rows).toEqual([
      {
        matchKey: "p:9039039900",
        displayNumber: "79039039900",
        provider: "MCN Telecom",
        rowId: "did:p:9039039900",
      },
    ]);
  });

  it("leaves the source empty when two providers share a number", () => {
    const rows = collapseDidSources([
      { msisdn: "79039039900", providerCode: "mcn" },
      { msisdn: "89039039900", providerCode: "sipout" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider).toBe("");
  });

  it("stores a Finenumbers provider as Вручную", () => {
    const rows = collapseDidSources([
      { msisdn: "79039039900", providerCode: "finenumbers" },
      { msisdn: "79001112233", providerCode: "Finenumbers" },
    ]);
    expect(rows.map((row) => row.provider)).toEqual(["Вручную", "Вручную"]);
  });

  it("keeps the named provider when the other label is empty", () => {
    const rows = collapseDidSources([
      { msisdn: "79039039900", providerCode: "" },
      { msisdn: "79039039900", providerCode: "mcn" },
    ]);
    expect(rows[0]?.provider).toBe("MCN Telecom");
  });

  it("counts an empty msisdn and ignores the local number", () => {
    const walk = createPurchasedWalk();
    notePurchasedTotal(walk, 2);
    acceptPurchasedItems(walk, [
      purchased("", "mcn"),
      { ...purchased("79001112233", "mcn"), number_local: "1112233" },
    ]);
    expect(finishPurchasedWalk(walk)).toEqual([
      {
        matchKey: "p:9001112233",
        displayNumber: "79001112233",
        provider: "MCN Telecom",
        rowId: "did:p:9001112233",
      },
    ]);
    expect(walk.seen).toBe(2);
  });

  it("rejects an unsafe number, a repeated pair, a foreign inventory, and a changed total", () => {
    const unsafe = createPurchasedWalk();
    notePurchasedTotal(unsafe, 1);
    expect(() => acceptPurchasedItems(unsafe, [purchased(1.5)])).toThrow(/MSISDN/);

    const duplicate = createPurchasedWalk();
    notePurchasedTotal(duplicate, 2);
    expect(() =>
      acceptPurchasedItems(duplicate, [
        purchased("79001112233", "mcn"),
        purchased("79001112233", "mcn"),
      ]),
    ).toThrow(/DUPLICATE/);

    const foreign = createPurchasedWalk();
    notePurchasedTotal(foreign, 1);
    expect(() =>
      acceptPurchasedItems(foreign, [{ inventory_kind: "free", msisdn: "79001112233" }]),
    ).toThrow(/KIND/);

    const changed = createPurchasedWalk();
    notePurchasedTotal(changed, 2);
    expect(() => notePurchasedTotal(changed, 3)).toThrow(/TOTAL_CHANGED/);

    const short = createPurchasedWalk();
    notePurchasedTotal(short, 2);
    acceptPurchasedItems(short, [purchased("79001112233")]);
    expect(() => finishPurchasedWalk(short)).toThrow(/SHORT/);
  });
});

describe("syncDidSnapshot", () => {
  function harness(opts: {
    state?: DidSnapshotState;
    pages?: { items: unknown[]; total: number }[];
    publish?: boolean;
    heartbeat?: boolean;
    creds?: DidCredentials | null;
  }) {
    const state = opts.state ?? { generation: 0, refreshedAt: null, attemptedAt: null };
    const pages = opts.pages ?? [{ items: [], total: 0 }];
    const inserted: { generation: number; rows: DidSourceRow[] }[] = [];
    const deleted: number[] = [];
    const deletedOther: number[] = [];
    const published: number[] = [];
    let released = 0;
    const deps: DidSnapshotDeps = {
      now: () => new Date("2026-11-07T12:00:00.000Z"),
      newToken: () => "token-1",
      loadCreds: async () => (opts.creds === undefined ? creds : opts.creds),
      readState: async () => state,
      tryLease: async () => true,
      heartbeat: async () => opts.heartbeat !== false,
      release: async () => {
        released += 1;
      },
      markAttempt: async () => {},
      deleteGeneration: async (generation) => {
        deleted.push(generation);
      },
      deleteOtherGenerations: async (keep) => {
        deletedOther.push(keep);
      },
      insertRows: async (generation, rows) => {
        inserted.push({ generation, rows: [...rows] });
      },
      publish: async (_expected, next) => {
        published.push(next);
        return opts.publish !== false;
      },
      loadPage: async (page) =>
        pages[page - 1] ?? { items: [], total: pages[0]?.total ?? 0 },
    };
    return { deps, inserted, deleted, deletedOther, published, released: () => released };
  }

  it("publishes an empty catalog and drops the previous generation", async () => {
    const used = harness({ pages: [{ items: [], total: 0 }] });
    const result = await syncDidSnapshot(used.deps);
    expect(result).toEqual({ status: "published" });
    expect(used.inserted).toEqual([{ generation: 1, rows: [] }]);
    expect(used.published).toEqual([1]);
    expect(used.deleted).toEqual([]);
    expect(used.deletedOther).toEqual([0, 1]);
    expect(used.released()).toBe(1);
  });

  it("keeps the previous snapshot when the page is short of total", async () => {
    const used = harness({
      pages: [{ items: [purchased("79001112233")], total: 2 }],
    });
    const result = await syncDidSnapshot(used.deps);
    expect(result).toEqual({ status: "kept", code: "SHORT" });
    expect(used.published).toEqual([]);
    expect(used.inserted).toEqual([]);
    expect(used.deleted).toEqual([1]);
    expect(used.released()).toBe(1);
  });

  it("does not publish when the lease is lost", async () => {
    const used = harness({
      heartbeat: false,
      pages: [{ items: [purchased("79001112233")], total: 1 }],
    });
    const result = await syncDidSnapshot(used.deps);
    expect(result).toEqual({ status: "kept", code: "LEASE" });
    expect(used.published).toEqual([]);
    expect(used.deleted).toEqual([1]);
  });

  it("does not publish when the generation switch loses", async () => {
    const used = harness({
      publish: false,
      pages: [{ items: [purchased("79001112233")], total: 1 }],
    });
    const result = await syncDidSnapshot(used.deps);
    expect(result).toEqual({ status: "kept", code: "PUBLISH" });
    expect(used.deleted).toEqual([1]);
    expect(used.deletedOther).toEqual([0]);
  });

  it("skips a fresh snapshot and a missing token without taking a lease", async () => {
    const fresh = harness({
      state: {
        generation: 3,
        refreshedAt: new Date("2026-11-07T11:59:00.000Z"),
        attemptedAt: null,
      },
    });
    const tryLease = vi.fn(async () => true);
    fresh.deps.tryLease = tryLease;
    expect(await syncDidSnapshot(fresh.deps)).toEqual({ status: "skipped" });
    expect(tryLease).not.toHaveBeenCalled();

    const missing = harness({ creds: null });
    missing.deps.tryLease = tryLease;
    expect(await syncDidSnapshot(missing.deps)).toEqual({ status: "skipped" });
    expect(tryLease).not.toHaveBeenCalled();
    expect(didSnapshotIsFresh(null, new Date())).toBe(false);

    const attempted = harness({
      state: {
        generation: 3,
        refreshedAt: null,
        attemptedAt: new Date("2026-11-07T11:59:00.000Z"),
      },
    });
    attempted.deps.tryLease = tryLease;
    expect(await syncDidSnapshot(attempted.deps)).toEqual({ status: "skipped" });
    expect(tryLease).not.toHaveBeenCalled();
  });
});
