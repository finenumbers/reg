import { describe, expect, it } from "vitest";
import {
  DUPLICATE_NUMBER,
  DIRECTORY_INCOMPLETE,
  KDU_WITHOUT_RUSSIA,
  NO_FREE_CELLS,
  UNREADABLE,
  leafRegionIds,
  parseDirectory,
  parseFree,
  parsePurchased,
  parsePurchasedTotal,
  planFreeCells,
  scrubExolveText,
} from "@/modules/exolve/parse";
import { FREE_LIMIT, PURCHASED_LIMIT } from "@/modules/exolve/url";

const NUMBER = "79300655934";

describe("Exolve page parse", () => {
  it("admits a purchased number and keeps an 8 prefix", () => {
    const page = parsePurchased(
      { total: 2, numbers: [{ number_name: NUMBER }, { number_name: "89991234455" }] },
      PURCHASED_LIMIT,
    );
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.rows).toEqual([NUMBER, "89991234455"]);
  });

  it("rejects a formatted number, an unsafe integer, and a duplicate on one page", () => {
    expect(parsePurchased({ total: 1, numbers: [{ number_name: "7 930 065 59 34" }] }, 10).ok).toBe(
      false,
    );
    expect(parseFree({ numbers: [{ number_code: Number.MAX_VALUE }] }, FREE_LIMIT).ok).toBe(false);
    const dup = parsePurchased(
      { total: 2, numbers: [{ number_name: NUMBER }, { number_name: NUMBER }] },
      PURCHASED_LIMIT,
    );
    expect(dup).toEqual({ ok: false, error: DUPLICATE_NUMBER });
  });

  it("fails a page that is longer than the limit or has no numbers array", () => {
    const numbers = Array.from({ length: PURCHASED_LIMIT + 1 }, (_, index) => ({
      number_name: `79${String(index).padStart(9, "0")}`,
    }));
    expect(parsePurchased({ total: numbers.length, numbers }, PURCHASED_LIMIT)).toEqual({
      ok: false,
      error: UNREADABLE,
    });
    expect(parseFree({}, FREE_LIMIT)).toEqual({ ok: false, error: UNREADABLE });
    expect(parseFree({ numbers: null }, FREE_LIMIT)).toEqual({ ok: false, error: UNREADABLE });
    expect(parsePurchased({ numbers: [] }, PURCHASED_LIMIT).ok).toBe(false);
  });

  it("treats an error body as a failure and an empty numbers array as an empty page", () => {
    expect(parseFree({ error: "nope", numbers: [] }, FREE_LIMIT).ok).toBe(false);
    expect(parsePurchased({ error: "nope", total: 0, numbers: [] }, PURCHASED_LIMIT).ok).toBe(
      false,
    );
    expect(parseFree({ numbers: [] }, FREE_LIMIT)).toEqual({ ok: true, rows: [] });
    expect(parsePurchased({ total: "0", numbers: [] }, PURCHASED_LIMIT)).toEqual({
      ok: true,
      total: 0,
      rows: [],
    });
    expect(parsePurchased({ total: "01", numbers: [] }, PURCHASED_LIMIT).ok).toBe(false);
  });

  it("keeps a decimal price and leaves a bad price empty", () => {
    const page = parseFree(
      {
        numbers: [
          { number_code: NUMBER, install_fee: 590, subscription_fee: "150.5" },
          { number_code: "79300655935", install_fee: null, subscription_fee: -1 },
          { number_code: "79300655936", install_fee: "1e2", subscription_fee: "12.5.1" },
        ],
      },
      FREE_LIMIT,
    );
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.rows.map((row) => [row.incomingPurchase, row.incomingPeriod])).toEqual([
      ["590", "150.5"],
      ["", ""],
      ["", ""],
    ]);
  });

  it("reads only the purchased total on a recount", () => {
    expect(parsePurchasedTotal({ total: "250", numbers: [{ garbage: true }] })).toEqual({
      ok: true,
      total: 250,
    });
    expect(parsePurchasedTotal({ total: 1 }).ok).toBe(false);
  });

  it("joins categories onto types and rejects an incomplete directory", () => {
    const parsed = parseDirectory({
      types: [
        { type_id: 1106, type_name: "KDU" },
        { type_id: "1104", type_name: "DEF" },
      ],
      categories: [
        { category_id: 10000, type_id: 1104, type_name: "DEF" },
        { category_id: 10002, type_id: 1106, type_name: "KDU" },
      ],
      regions: [
        { region_id: 10230, parent_region_id: 10084 },
        { region_id: 10084 },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.directory.types.map((type) => type.typeId)).toEqual([1104, 1106]);
    expect(leafRegionIds(parsed.directory.regions)).toEqual([10230]);
    const cells = planFreeCells(parsed.directory);
    expect(cells.ok).toBe(true);
    if (!cells.ok) return;
    expect(cells.cells).toEqual([
      { typeId: 1104, categoryId: 10000, regionId: 10084 },
      { typeId: 1104, categoryId: 10000, regionId: 10230 },
      { typeId: 1106, categoryId: 10002, regionId: 10084 },
    ]);
  });

  it("does not build free cells from an empty directory or KDU without Russia", () => {
    const empty = parseDirectory({ types: [], categories: [], regions: [] });
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    expect(planFreeCells(empty.directory)).toEqual({ ok: false, error: NO_FREE_CELLS });

    const kdu = parseDirectory({
      types: [{ type_id: 1106, type_name: "KDU" }],
      categories: [{ category_id: 10002, type_id: 1106 }],
      regions: [{ region_id: 10230 }],
    });
    expect(kdu.ok).toBe(true);
    if (!kdu.ok) return;
    expect(planFreeCells(kdu.directory)).toEqual({ ok: false, error: KDU_WITHOUT_RUSSIA });

    expect(
      parseDirectory({
        types: [{ type_id: 1104, type_name: "DEF" }],
        categories: [],
        regions: [],
      }),
    ).toEqual({ ok: false, error: DIRECTORY_INCOMPLETE });
  });

  it("drops an operator error that contains the key or a URL", () => {
    expect(scrubExolveText("secret-key", "bad secret-key")).toBeNull();
    expect(scrubExolveText("secret-key", "see https://api.exolve.ru")).toBeNull();
    expect(scrubExolveText("secret-key", "invalid value")).toBe("invalid value");
  });
});
