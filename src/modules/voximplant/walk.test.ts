import { describe, expect, it, vi } from "vitest";
import {
  BAD_CATEGORY,
  DUPLICATE_NUMBER,
  NUMBER_UNREAD,
  PAGE_TOO_LONG,
  STATES_REQUIRED,
  parseCategories,
  parseFreePage,
  parsePurchasedPage,
  parseRegions,
  regionIsRead,
  type CallMeta,
  type FreeRow,
  type PhoneCategory,
  type PhoneRegion,
} from "@/modules/voximplant/parse";
import {
  FREE_COUNT,
  OFFSET_MAX,
  PURCHASED_COUNT,
  offsetTooFar,
} from "@/modules/voximplant/url";
import {
  CANCELLED,
  EMPTY_DIRECTORY,
  NO_REGIONS,
  OVER_TOTAL,
  SHORT_LIST,
  TOTAL_MOVED,
  runAccessProbe,
  runVoximplantWalk,
  type NumberPage,
  type TotalPage,
} from "@/modules/voximplant/walk";

const A = "74951234567";
const B = "74957654321";
const C = "84951234567";

function meta(): CallMeta {
  return { status: 200, attempts: 1, durationMs: 4 };
}

function purchased(rows: string[], total: number): NumberPage<FreeRow> {
  return {
    ok: true,
    rows: rows.map((e164) => ({ e164, incomingPurchase: "", incomingPeriod: "" })),
    total,
    meta: meta(),
  };
}

function free(rows: FreeRow[], total: number): NumberPage<FreeRow> {
  return { ok: true, rows, total, meta: meta() };
}

function total(value: number): TotalPage {
  return { ok: true, total: value, meta: meta() };
}

function row(e164: string, purchase = "100", period = "20"): FreeRow {
  return { e164, incomingPurchase: purchase, incomingPeriod: period };
}

async function run(overrides: Partial<Parameters<typeof runVoximplantWalk>[0]> = {}) {
  const stagePurchased = vi.fn(async () => undefined);
  const dropPurchased = vi.fn(async () => undefined);
  const stageFree = vi.fn(async () => undefined);
  const log = vi.fn(async () => undefined);
  const result = await runVoximplantWalk({
    beat: async () => "run",
    purchasedPage: async () => purchased([], 0),
    purchasedRecount: async () => total(0),
    categories: async () => ({ ok: true, categories: [], meta: meta() }),
    regions: async () => ({ ok: true, regions: [], meta: meta() }),
    freePage: async () => free([], 0),
    freeRecount: async () => total(0),
    stagePurchased,
    dropPurchased,
    stageFree,
    log,
    ...overrides,
  });
  return { result, stagePurchased, dropPurchased, stageFree, log };
}

describe("Voximplant pages", () => {
  it("ignores the count field and keeps a short page", () => {
    const parsed = parsePurchasedPage(
      {
        result: [{ phone_number: A }, { phone_number: `+${B}` }],
        total_count: 4,
        count: 80,
      },
      PURCHASED_COUNT,
    );
    expect(parsed.ok && parsed.rows).toEqual([
      { e164: A, incomingPurchase: "", incomingPeriod: "" },
      { e164: B, incomingPurchase: "", incomingPeriod: "" },
    ]);
  });

  it("rejects a page longer than the request and a number that is not admitted", () => {
    const long = parseFreePage(
      {
        result: Array.from({ length: FREE_COUNT + 1 }, (_, index) => ({
          phone_number: `7495${String(index).padStart(7, "0")}`,
        })),
        total_count: FREE_COUNT + 1,
      },
      FREE_COUNT,
    );
    expect(long).toEqual({ ok: false, error: PAGE_TOO_LONG });
    const unread = parsePurchasedPage(
      { result: [{ phone_number: "123" }], total_count: 1 },
      PURCHASED_COUNT,
    );
    expect(unread).toEqual({ ok: false, error: NUMBER_UNREAD });
  });

  it("stores the purchased monthly charge and leaves the one-time cell empty", () => {
    const parsed = parsePurchasedPage(
      {
        result: [
          {
            phone_number: A,
            phone_price: "20.5",
            phone_installation_price: 100,
            phone_tax_reserve: 5,
          },
          { phone_number: B, phone_price: "1e2" },
        ],
        total_count: 2,
      },
      PURCHASED_COUNT,
    );
    expect(parsed.ok && parsed.rows).toEqual([
      { e164: A, incomingPurchase: "", incomingPeriod: "20.5" },
      { e164: B, incomingPurchase: "", incomingPeriod: "" },
    ]);
  });

  it("keeps an 8 and a 10-digit number, and stores only the two free prices", () => {
    const parsed = parseFreePage(
      {
        result: [
          {
            phone_number: C,
            phone_installation_price: 100,
            phone_price: "20.5",
            phone_installation_tax_reserve: 50,
            phone_tax_reserve: 5,
          },
          {
            phone_number: "4951234567",
            phone_installation_price: -1,
            phone_price: "1e2",
          },
        ],
        total_count: 2,
      },
      FREE_COUNT,
    );
    expect(parsed.ok && parsed.rows).toEqual([
      row(C, "100", "20.5"),
      row("4951234567", "", ""),
    ]);
  });

  it("drops countries other than RU and stops when a category has states", () => {
    const parsed = parseCategories({
      result: [
        { country_code: "US", can_list_phone_numbers: true, phone_categories: [] },
        {
          country_code: "RU",
          phone_categories: [
            { phone_category_name: "GEOGRAPHIC" },
            { phone_category_name: "GEOGRAPHIC", country_has_states: false },
            { phone_category_name: "MOBILE", country_has_states: false },
          ],
        },
      ],
    });
    expect(parsed.ok && parsed.categories).toEqual([
      { name: "GEOGRAPHIC" },
      { name: "MOBILE" },
    ]);
    const states = parseCategories({
      result: [
        {
          country_code: "RU",
          can_list_phone_numbers: true,
          phone_categories: [
            { phone_category_name: "GEOGRAPHIC", country_has_states: true },
          ],
        },
      ],
    });
    expect(states).toEqual({ ok: false, error: STATES_REQUIRED });
    const hidden = parseCategories({
      result: [
        {
          country_code: "RU",
          can_list_phone_numbers: false,
          phone_categories: [
            { phone_category_name: "GEOGRAPHIC", country_has_states: true },
          ],
        },
      ],
    });
    expect(hidden.ok && hidden.categories).toEqual([]);
  });

  it("fails a region id that is not an integer and does not skip a missing count", () => {
    expect(parseRegions({ result: [{ phone_region_id: "12", phone_count: 1 }] })).toEqual(
      {
        ok: false,
        error: expect.stringContaining("региона"),
      },
    );
    const parsed = parseRegions({
      result: [
        { phone_region_id: 1, phone_count: 0 },
        { phone_region_id: 1, phone_count: 9 },
        { phone_region_id: 2, phone_count: 1.5 },
        { phone_region_id: 3 },
      ],
    });
    expect(parsed.ok && parsed.regions).toEqual([
      { id: 1, phoneCount: 0 },
      { id: 2, phoneCount: null },
      { id: 3, phoneCount: null },
    ]);
    if (!parsed.ok) return;
    expect(parsed.regions.filter(regionIsRead).map((region) => region.id)).toEqual([
      2, 3,
    ]);
  });

  it("rejects a category name the platform would not accept", () => {
    const parsed = parseCategories({
      result: [
        {
          country_code: "RU",
          phone_categories: [{ phone_category_name: "Москва" }],
        },
      ],
    });
    expect(parsed).toEqual({ ok: false, error: BAD_CATEGORY });
  });
});

describe("Voximplant walk", () => {
  it("advances the offset by the accepted rows and does not stop on a short page", async () => {
    const offsets: number[] = [];
    const { result } = await run({
      purchasedPage: async (offset) => {
        offsets.push(offset);
        if (offset === 0) return purchased([A], 3);
        if (offset === 1) return purchased([B], 3);
        return purchased([C], 3);
      },
      purchasedRecount: async () => total(3),
      categories: async () => ({ ok: false, error: EMPTY_DIRECTORY, meta: meta() }),
    });
    expect(offsets).toEqual([0, 1, 2]);
    expect(result).toEqual({ ok: false, error: EMPTY_DIRECTORY, reason: "fail" });
  });

  it("rejects a page longer than the purchased page size", async () => {
    const rows = Array.from(
      { length: PURCHASED_COUNT + 1 },
      (_, index) => `7495${String(index).padStart(7, "0")}`,
    );
    const { result, stagePurchased } = await run({
      purchasedPage: async () => purchased(rows, rows.length),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(PAGE_TOO_LONG);
    expect(stagePurchased).not.toHaveBeenCalled();
  });

  it("keeps a free tail that fills the locked total when that page reports another total", async () => {
    const offsets: number[] = [];
    const { result, stageFree, log } = await run({
      categories: async () => ({
        ok: true,
        categories: [{ name: "GEO_CATEGORY2" }],
        meta: meta(),
      }),
      regions: async () => ({
        ok: true,
        regions: [{ id: 129, phoneCount: 3 }],
        meta: meta(),
      }),
      freePage: async (_category, _region, offset) => {
        offsets.push(offset);
        if (offset === 0) return free([row(A)], 3);
        if (offset === 1) return free([row(B)], 3);
        return free([row(C)], 9);
      },
      freeRecount: async () => total(3),
    });
    expect(result).toEqual({ ok: true });
    expect(offsets).toEqual([0, 1, 2]);
    expect(stageFree).toHaveBeenCalledTimes(1);
    expect(stageFree).toHaveBeenCalledWith([row(A), row(B), row(C)]);
    expect(JSON.stringify(log.mock.calls)).toContain("offset=2 total=9 rows=1");
  });

  it("raises the locked total when the free tail rows equal that larger total", async () => {
    const third = "74950000001";
    const fourth = "74950000002";
    const { result, stageFree } = await run({
      categories: async () => ({
        ok: true,
        categories: [{ name: "GEO_CATEGORY2" }],
        meta: meta(),
      }),
      regions: async () => ({
        ok: true,
        regions: [{ id: 129, phoneCount: 4 }],
        meta: meta(),
      }),
      freePage: async (_category, _region, offset) => {
        if (offset === 0) return free([row(A), row(B)], 4);
        return free([row(C), row(third), row(fourth)], 5);
      },
      freeRecount: async () => total(4),
    });
    expect(result).toEqual({ ok: true });
    expect(stageFree).toHaveBeenCalledTimes(1);
    expect(stageFree).toHaveBeenCalledWith([
      row(A),
      row(B),
      row(C),
      row(third),
      row(fourth),
    ]);
  });

  it("does not raise the locked total when the larger total is not the row sum", async () => {
    const offsets: number[] = [];
    const { result, stageFree } = await run({
      categories: async () => ({
        ok: true,
        categories: [{ name: "GEO_CATEGORY2" }],
        meta: meta(),
      }),
      regions: async () => ({
        ok: true,
        regions: [{ id: 129, phoneCount: 4 }],
        meta: meta(),
      }),
      freePage: async (_category, _region, offset) => {
        offsets.push(offset);
        if (offset === 0) return free([row(A), row(B)], 4);
        return free([row(C)], 9);
      },
      freeRecount: async () => total(4),
    });
    expect(result).toEqual({ ok: false, error: TOTAL_MOVED, reason: "fail" });
    expect(offsets).toEqual([0, 2, 0, 2]);
    expect(stageFree).not.toHaveBeenCalled();
  });

  it("does not publish a raised free total when the recount matches neither total", async () => {
    const { result, stageFree } = await run({
      categories: async () => ({
        ok: true,
        categories: [{ name: "GEO_CATEGORY2" }],
        meta: meta(),
      }),
      regions: async () => ({
        ok: true,
        regions: [{ id: 129, phoneCount: 4 }],
        meta: meta(),
      }),
      freePage: async (_category, _region, offset) => {
        if (offset === 0) return free([row(A), row(B)], 4);
        return free([row(C), row("74950000001"), row("74950000002")], 5);
      },
      freeRecount: async () => total(8),
    });
    expect(result).toEqual({ ok: false, error: TOTAL_MOVED, reason: "fail" });
    expect(stageFree).not.toHaveBeenCalled();
  });

  it("does not keep a free page that passes or falls short of the locked total", async () => {
    const longer = await run({
      categories: async () => ({
        ok: true,
        categories: [{ name: "GEO_CATEGORY2" }],
        meta: meta(),
      }),
      regions: async () => ({
        ok: true,
        regions: [{ id: 129, phoneCount: 3 }],
        meta: meta(),
      }),
      freePage: async (_category, _region, offset) => {
        if (offset === 0) return free([row(A)], 3);
        if (offset === 1) return free([row(B)], 3);
        return free([row(C), row("74950000001")], 9);
      },
      freeRecount: async () => total(3),
    });
    expect(longer.result).toEqual({ ok: false, error: TOTAL_MOVED, reason: "fail" });
    expect(longer.stageFree).not.toHaveBeenCalled();

    const shorter = await run({
      categories: async () => ({
        ok: true,
        categories: [{ name: "GEO_CATEGORY2" }],
        meta: meta(),
      }),
      regions: async () => ({
        ok: true,
        regions: [{ id: 129, phoneCount: 3 }],
        meta: meta(),
      }),
      freePage: async (_category, _region, offset) =>
        offset === 0 ? free([row(A)], 3) : free([row(B)], 9),
      freeRecount: async () => total(3),
    });
    expect(shorter.result).toEqual({ ok: false, error: TOTAL_MOVED, reason: "fail" });
    expect(shorter.stageFree).not.toHaveBeenCalled();

    const emptyTail = await run({
      categories: async () => ({
        ok: true,
        categories: [{ name: "GEO_CATEGORY2" }],
        meta: meta(),
      }),
      regions: async () => ({
        ok: true,
        regions: [{ id: 129, phoneCount: 3 }],
        meta: meta(),
      }),
      freePage: async (_category, _region, offset) => {
        if (offset === 0) return free([row(A)], 3);
        if (offset === 1) return free([row(B)], 3);
        return free([], 9);
      },
      freeRecount: async () => total(3),
    });
    expect(emptyTail.result).toEqual({ ok: false, error: TOTAL_MOVED, reason: "fail" });
    expect(emptyTail.stageFree).not.toHaveBeenCalled();
  });

  it("does not publish a completed free tail when the recount disagrees", async () => {
    const { result, stageFree } = await run({
      categories: async () => ({
        ok: true,
        categories: [{ name: "GEO_CATEGORY2" }],
        meta: meta(),
      }),
      regions: async () => ({
        ok: true,
        regions: [{ id: 129, phoneCount: 3 }],
        meta: meta(),
      }),
      freePage: async (_category, _region, offset) => {
        if (offset === 0) return free([row(A)], 3);
        if (offset === 1) return free([row(B)], 3);
        return free([row(C)], 9);
      },
      freeRecount: async () => total(9),
    });
    expect(result).toEqual({ ok: false, error: TOTAL_MOVED, reason: "fail" });
    expect(stageFree).not.toHaveBeenCalled();
  });

  it("reads a repeated free number once more and then stops", async () => {
    let calls = 0;
    const { result, stageFree } = await run({
      categories: async () => ({
        ok: true,
        categories: [{ name: "GEO_CATEGORY2" }],
        meta: meta(),
      }),
      regions: async () => ({
        ok: true,
        regions: [{ id: 129, phoneCount: 2 }],
        meta: meta(),
      }),
      freePage: async (_category, _region, offset) => {
        calls += 1;
        return offset === 0 ? free([row(A)], 2) : free([row(A)], 9);
      },
      freeRecount: async () => total(2),
    });
    expect(calls).toBe(4);
    expect(result).toEqual({ ok: false, error: DUPLICATE_NUMBER, reason: "fail" });
    expect(stageFree).not.toHaveBeenCalled();
  });

  it("reads a selection again when the total moves, and stops on the second move", async () => {
    const offsets: number[] = [];
    let attempt = 0;
    const { result, dropPurchased, stageFree } = await run({
      purchasedPage: async (offset) => {
        offsets.push(offset);
        if (offset === 0) return purchased([A], 2);
        attempt += 1;
        return purchased([B], attempt === 1 ? 9 : 8);
      },
    });
    expect(result).toEqual({ ok: false, error: TOTAL_MOVED, reason: "fail" });
    expect(offsets).toEqual([0, 1, 0, 1]);
    expect(dropPurchased).toHaveBeenCalled();
    expect(stageFree).not.toHaveBeenCalled();
  });

  it("does not stage the recount page", async () => {
    const pages: number[] = [];
    const recounts: number[] = [];
    const { stagePurchased, result } = await run({
      purchasedPage: async (offset) => {
        pages.push(offset);
        return purchased([A], 1);
      },
      purchasedRecount: async () => {
        recounts.push(1);
        return total(1);
      },
      categories: async () => ({
        ok: true,
        categories: [{ name: "GEOGRAPHIC" }],
        meta: meta(),
      }),
      regions: async () => ({
        ok: true,
        regions: [{ id: 7, phoneCount: 1 }],
        meta: meta(),
      }),
      freePage: async () => free([row(B, "10", "3")], 1),
      freeRecount: async () => total(1),
    });
    expect(result).toEqual({ ok: true });
    expect(pages).toEqual([0]);
    expect(recounts).toEqual([1]);
    expect(stagePurchased).toHaveBeenCalledTimes(1);
    expect(stagePurchased).toHaveBeenCalledWith([
      { e164: A, incomingPurchase: "", incomingPeriod: "" },
    ]);
  });

  it("does not publish when Russia has no categories or no regions", async () => {
    const empty = await run();
    expect(empty.result).toEqual({ ok: false, error: EMPTY_DIRECTORY, reason: "fail" });
    expect(empty.stageFree).not.toHaveBeenCalled();

    const noRegions = await run({
      categories: async () => ({
        ok: true,
        categories: [{ name: "GEOGRAPHIC" }] satisfies PhoneCategory[],
        meta: meta(),
      }),
      regions: async () => ({
        ok: true,
        regions: [] satisfies PhoneRegion[],
        meta: meta(),
      }),
    });
    expect(noRegions.result).toEqual({ ok: false, error: NO_REGIONS, reason: "fail" });
    expect(noRegions.stageFree).not.toHaveBeenCalled();
  });

  it("publishes an empty free slice when every readable selection is empty", async () => {
    const { result, stageFree } = await run({
      categories: async () => ({
        ok: true,
        categories: [{ name: "GEOGRAPHIC" }],
        meta: meta(),
      }),
      regions: async () => ({
        ok: true,
        regions: [{ id: 4, phoneCount: 2 }],
        meta: meta(),
      }),
      freePage: async () => free([], 0),
      freeRecount: async () => total(0),
    });
    expect(result).toEqual({ ok: true });
    expect(stageFree).not.toHaveBeenCalled();
  });

  it("skips a region with no stock and keeps the first free price", async () => {
    const calls: number[] = [];
    const { result, stageFree } = await run({
      categories: async () => ({
        ok: true,
        categories: [{ name: "GEOGRAPHIC" }],
        meta: meta(),
      }),
      regions: async () => ({
        ok: true,
        regions: [
          { id: 1, phoneCount: 0 },
          { id: 2, phoneCount: null },
          { id: 3, phoneCount: 1 },
        ],
        meta: meta(),
      }),
      freePage: async (_category, regionId) => {
        calls.push(regionId);
        return free([row(A, regionId === 2 ? "10" : "99", "4")], 1);
      },
      freeRecount: async () => total(1),
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([2, 3]);
    expect(stageFree).toHaveBeenCalledTimes(1);
    expect(stageFree).toHaveBeenCalledWith([row(A, "10", "4")]);
  });

  it("retries one empty page and then fails a second empty page", async () => {
    let calls = 0;
    const { result } = await run({
      purchasedPage: async () => {
        calls += 1;
        return purchased([], 5);
      },
    });
    expect(calls).toBe(2);
    expect(result).toEqual({ ok: false, error: SHORT_LIST, reason: "fail" });
  });

  it("fails when a page is longer than the locked total", async () => {
    const { result, stagePurchased } = await run({
      purchasedPage: async () => purchased([A, B], 1),
    });
    expect(result).toEqual({ ok: false, error: OVER_TOTAL, reason: "fail" });
    expect(stagePurchased).not.toHaveBeenCalled();
  });

  it("fails a repeated number on the next page", async () => {
    const { result } = await run({
      purchasedPage: async (offset) =>
        offset === 0 ? purchased([A], 2) : purchased([A], 2),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(DUPLICATE_NUMBER);
  });

  it("stops when the next offset would pass the ceiling", () => {
    expect(OFFSET_MAX).toBe(5_000_000);
    expect(offsetTooFar(OFFSET_MAX)).toBe(false);
    expect(offsetTooFar(OFFSET_MAX + 1)).toBe(true);
  });

  it("cancels before the next page and does not open free numbers", async () => {
    let beats = 0;
    const { result, stageFree } = await run({
      beat: async () => {
        beats += 1;
        return beats === 1 ? "run" : "cancel";
      },
      purchasedPage: async () => purchased([A], 2),
    });
    expect(result).toEqual({ ok: false, error: CANCELLED, reason: "cancel" });
    expect(stageFree).not.toHaveBeenCalled();
  });
});

describe("Voximplant access probe", () => {
  it("stops on the first failure and reads one free page only for a region the walk would read", async () => {
    const calls: string[] = [];
    const stopped = await runAccessProbe({
      purchased: async () => {
        calls.push("purchased");
        return { ok: false, error: "нет" };
      },
      categories: async () => {
        calls.push("categories");
        return { ok: true, categories: [] };
      },
      regions: async () => ({ ok: true, regions: [] }),
      free: async () => ({ ok: true }),
    });
    expect(stopped.ok).toBe(false);
    expect(calls).toEqual(["purchased"]);

    const freeCalls: Array<[string, number, number, number]> = [];
    const ready = await runAccessProbe({
      purchased: async (offset, count) => {
        expect(offset).toBe(0);
        expect(count).toBe(1);
        return { ok: true };
      },
      categories: async () => ({
        ok: true,
        categories: [{ name: "GEOGRAPHIC" }, { name: "MOBILE" }],
      }),
      regions: async (category) => {
        expect(category).toBe("GEOGRAPHIC");
        return {
          ok: true,
          regions: [
            { id: 1, phoneCount: 0 },
            { id: 8, phoneCount: 3 },
          ],
        };
      },
      free: async (category, regionId, offset, count) => {
        freeCalls.push([category, regionId, offset, count]);
        return { ok: true };
      },
    });
    expect(ready).toEqual({ ok: true });
    expect(freeCalls).toEqual([["GEOGRAPHIC", 8, 0, 1]]);
  });
});
