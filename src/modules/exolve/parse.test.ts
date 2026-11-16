import { describe, expect, it } from "vitest";
import {
  DUPLICATE_NUMBER,
  DIRECTORY_INCOMPLETE,
  NO_FREE_CELLS,
  NO_TOTAL,
  NUMBER_UNREAD,
  PAGE_TOO_LONG,
  PLATFORM_ERROR,
  PLATFORM_REJECTED,
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
    expect(
      parsePurchased({ total: 1, numbers: [{ number_name: "7 930 065 59 34" }] }, 10).ok,
    ).toBe(false);
    expect(parseFree({ numbers: [{ number_code: Number.MAX_VALUE }] }).ok).toBe(false);
    const dup = parsePurchased(
      { total: 2, numbers: [{ number_name: NUMBER }, { number_name: NUMBER }] },
      PURCHASED_LIMIT,
    );
    expect(dup).toEqual({ ok: false, error: DUPLICATE_NUMBER });
  });

  it("fails a page that is longer than the limit or has no total", () => {
    const numbers = Array.from({ length: PURCHASED_LIMIT + 1 }, (_, index) => ({
      number_name: `79${String(index).padStart(9, "0")}`,
    }));
    expect(parsePurchased({ total: numbers.length, numbers }, PURCHASED_LIMIT)).toEqual({
      ok: false,
      error: PAGE_TOO_LONG,
    });
    const longFree = Array.from({ length: FREE_LIMIT + 1 }, (_, index) => ({
      number_code: `79${String(index).padStart(9, "0")}`,
    }));
    const longPage = parseFree({ numbers: longFree });
    expect(longPage.ok).toBe(true);
    if (!longPage.ok) return;
    expect(longPage.rows).toHaveLength(FREE_LIMIT + 1);
    expect(parsePurchased({ numbers: [] }, PURCHASED_LIMIT).ok).toBe(false);
    const noTotal = parsePurchased(
      { numbers: [{ number_name: NUMBER }] },
      PURCHASED_LIMIT,
    );
    const wrapped = parsePurchased({ data: {} }, PURCHASED_LIMIT);
    expect(noTotal.ok).toBe(false);
    expect(wrapped.ok).toBe(false);
    if (noTotal.ok || wrapped.ok) return;
    expect(noTotal.error).toContain(NO_TOTAL);
    expect(wrapped.error).toContain(NO_TOTAL);
  });

  it("treats an error body as a failure and an empty numbers array as an empty page", () => {
    expect(parseFree({ error: "nope", numbers: [] })).toEqual({
      ok: false,
      error: "nope",
    });
    expect(
      parsePurchased({ error: "nope", total: 0, numbers: [] }, PURCHASED_LIMIT),
    ).toEqual({
      ok: false,
      error: "nope",
    });
    expect(
      parsePurchased(
        { error: "proto: syntax error (line 2:16): invalid value", total: 0 },
        PURCHASED_LIMIT,
      ),
    ).toEqual({
      ok: false,
      error: "proto: syntax error (line 2:16): invalid value",
    });
    expect(
      parsePurchased({ error: { message: "hidden" }, total: 0 }, PURCHASED_LIMIT),
    ).toEqual({
      ok: false,
      error: PLATFORM_ERROR,
    });
    expect(
      parsePurchased({ error: "number 79991234455", total: 0 }, PURCHASED_LIMIT),
    ).toEqual({
      ok: false,
      error: PLATFORM_REJECTED,
    });
    expect(parseFree({ numbers: [] })).toEqual({ ok: true, rows: [] });
    expect(parsePurchased({ total: "0", numbers: [] }, PURCHASED_LIMIT)).toEqual({
      ok: true,
      total: 0,
      rows: [],
    });
    expect(parsePurchased({ total: "01", numbers: [] }, PURCHASED_LIMIT).ok).toBe(false);
  });

  it("reads a proto3 empty purchased list and a hole in a long list", () => {
    expect(parsePurchased({}, PURCHASED_LIMIT)).toEqual({ ok: true, total: 0, rows: [] });
    expect(parsePurchased({ total: 0 }, PURCHASED_LIMIT)).toEqual({
      ok: true,
      total: 0,
      rows: [],
    });
    expect(parsePurchased({ total: "0" }, PURCHASED_LIMIT)).toEqual({
      ok: true,
      total: 0,
      rows: [],
    });
    expect(parsePurchased({ total: 0, numbers: null }, PURCHASED_LIMIT)).toEqual({
      ok: true,
      total: 0,
      rows: [],
    });
    expect(parsePurchased({ total: 300_000 }, PURCHASED_LIMIT)).toEqual({
      ok: true,
      total: 300_000,
      rows: [],
    });
    expect(parsePurchased({ total: 300_000, numbers: null }, PURCHASED_LIMIT)).toEqual({
      ok: true,
      total: 300_000,
      rows: [],
    });
    const missingTotal = parsePurchased({ numbers: null }, PURCHASED_LIMIT);
    expect(missingTotal.ok).toBe(false);
    if (!missingTotal.ok) expect(missingTotal.error).toContain(NO_TOTAL);
    expect(parseFree({})).toEqual({ ok: true, rows: [] });
    expect(parseFree({ numbers: null })).toEqual({ ok: true, rows: [] });
    expect(parseFree({ meta: 1 }).ok).toBe(false);
    const missing = parsePurchased(
      { total: 1, numbers: [{ type_name: "DEF" }] },
      PURCHASED_LIMIT,
    );
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error).toContain(NUMBER_UNREAD);
    expect(missing.error).toContain("type_name");
    expect(missing.error).not.toContain(NUMBER);
  });

  it("keeps a decimal price and leaves a bad price empty", () => {
    const page = parseFree({
      numbers: [
        { number_code: NUMBER, install_fee: 590, subscription_fee: "150.5" },
        { number_code: "79300655935", install_fee: null, subscription_fee: -1 },
        { number_code: "79300655936", install_fee: "1e2", subscription_fee: "12.5.1" },
      ],
    });
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
    expect(parsePurchasedTotal({})).toEqual({ ok: true, total: 0 });
    expect(parsePurchasedTotal({ total: 300_000 })).toEqual({ ok: true, total: 300_000 });
    expect(parsePurchasedTotal({ total: 300_000, numbers: null })).toEqual({
      ok: true,
      total: 300_000,
    });
    expect(parsePurchasedTotal({ numbers: [] }).ok).toBe(false);
  });

  it("keeps a type's own categories and still reads the other handbook types", () => {
    const parsed = parseDirectory({
      types: [
        { type_id: 1106, type_name: "KDU" },
        { type_id: "1104", type_name: "DEF" },
      ],
      categories: [
        { category_id: 10000, type_id: 1104, type_name: "DEF" },
        { category_id: 10000, type_id: 1104, type_name: "OTHER" },
        { category_id: 10002, type_id: 1106, type_name: "KDU" },
      ],
      regions: [
        { region_id: 10230, parent_region_id: 10084 },
        { region_id: 10230, parent_region_id: "bad" },
        { region_id: 10084 },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.directory.types.map((type) => type.typeId)).toEqual([1104, 1106]);
    expect(parsed.directory.types[0]?.categories).toEqual([{ categoryId: 10000 }]);
    expect(leafRegionIds(parsed.directory.regions)).toEqual([10230]);
    const cells = planFreeCells(parsed.directory);
    expect(cells.ok).toBe(true);
    if (!cells.ok) return;
    expect(cells.cells.filter((cell) => cell.typeId === 1104)).toEqual([
      { typeId: 1104, categoryId: 10000, regionId: 10084 },
      { typeId: 1104, categoryId: 10000, regionId: 10230 },
    ]);
    expect(cells.cells.filter((cell) => cell.typeId === 1106)).toEqual([
      { typeId: 1106, categoryId: 10002, regionId: 10084 },
    ]);
    expect(
      cells.cells.filter((cell) => cell.typeId === 1105).map((cell) => cell.categoryId),
    ).toEqual([
      10001, 10001, 10011, 10011, 10021, 10021, 10031, 10031, 10041, 10041, 10051, 10051,
    ]);
  });

  it("accepts the handbook directory and skips KDU when Russia is absent", () => {
    const parsed = parseDirectory({
      regions: [
        {
          project_id: 10008,
          region_id: 10257,
          parent_region_id: 10084,
          region_code: "SLH",
          region_name: "Salekhard",
          description: "Салехард",
        },
      ],
      types: [{ type_id: 1104, type_name: "DEF" }],
      categories: [
        { category_id: 10003, type_id: 1107, type_name: "CEN", category_name: "REGULAR" },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const def = parsed.directory.types.find((type) => type.typeId === 1104);
    expect(def?.categories).toEqual([]);
    expect(parsed.directory.types.some((type) => type.typeId === 1107)).toBe(true);
    const cells = planFreeCells(parsed.directory);
    expect(cells.ok).toBe(true);
    if (!cells.ok) return;
    expect(
      cells.cells.filter((cell) => cell.typeId === 1104).map((cell) => cell.categoryId),
    ).toEqual([10000, 10010, 10020, 10030, 10040, 10050]);
    expect(cells.cells.filter((cell) => cell.typeId === 1107)).toEqual([
      { typeId: 1107, categoryId: 10003, regionId: 10257 },
    ]);
    expect(cells.cells.some((cell) => cell.typeId === 1106)).toBe(false);
    expect(cells.cells.every((cell) => cell.regionId === 10257)).toBe(true);
  });

  it("does not build free cells without regions", () => {
    expect(parseDirectory({ types: [], categories: [], regions: [] })).toEqual({
      ok: false,
      error: DIRECTORY_INCOMPLETE,
    });
    expect(planFreeCells({ types: [], regions: [] })).toEqual({
      ok: false,
      error: NO_FREE_CELLS,
    });
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
    expect(scrubExolveText("secret-key", "number 79991234455")).toBeNull();
  });
});
