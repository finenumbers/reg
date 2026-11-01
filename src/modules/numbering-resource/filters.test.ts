import { describe, expect, it } from "vitest";
import {
  EMPTY_NUMBERING_FILTERS,
  parseNumberingFacetQuery,
  parseNumberingListQuery,
  pstnFacetParams,
  pstnListParams,
  pstnSummaryParams,
} from "@/modules/numbering-resource/filters";
import { NumberingQueryError } from "@/modules/numbering-resource/errors";

const rowFilters = JSON.stringify({
  abc: ["499", "495"],
  operator: ["Оператор"],
  garTerritory: ["Москва"],
  inn: ["7700000000"],
  uvrAntifraud: ["__empty__", "12"],
  changeStatus: ["added"],
  rangeStart: ["100"],
  capacity: ["10"],
});

describe("numbering resource query allowlist", () => {
  it("drops dataset, sort, diff fields, and numeric text filters", () => {
    const query = parseNumberingListQuery(
      new URLSearchParams({
        page: "1",
        dataset: "diff:11111111-1111-1111-1111-111111111111",
        sort: "capacity:desc,abc:asc",
        filters: rowFilters,
        phoneQ: "499_______",
      }),
    );
    const params = pstnListParams(query);
    expect(params.get("dataset")).toBeNull();
    expect(params.get("sort")).toBe("abc:asc,rangeStart:asc");
    expect(params.get("pageSize")).toBe("100");
    expect(params.get("page")).toBe("1");
    expect(params.get("cursor")).toBeNull();
    expect(params.get("filters.abc")).toBe("499|||495");
    expect(params.get("filters.operator")).toBe("Оператор");
    expect(params.get("filters.uvrAntifraud")).toBe("|||12");
    expect(params.get("filters.changeStatus")).toBeNull();
    expect(params.get("filters.rangeStart")).toBeNull();
    expect(params.get("filters.capacity")).toBeNull();
    expect(params.get("filters.phoneNumber")).toBe("499_______");
    expect(params.toString()).not.toContain("dataset");
  });

  it("rejects offset pages", () => {
    expect(() => parseNumberingListQuery(new URLSearchParams({ page: "2" }))).toThrow(
      NumberingQueryError,
    );
  });

  it("sends a cursor without a page", () => {
    const cursor = "abc_DEF-123";
    const params = pstnListParams({
      cursor,
      filters: EMPTY_NUMBERING_FILTERS,
    });
    expect(params.get("cursor")).toBe(cursor);
    expect(params.get("page")).toBeNull();
    expect(params.get("sort")).toBe("abc:asc,rangeStart:asc");
  });

  it("rejects a mask that is not 10 slots", () => {
    expect(() => parseNumberingListQuery(new URLSearchParams({ phoneQ: "499" }))).toThrow(
      /10 цифр/,
    );
  });

  it("omits an empty mask", () => {
    const params = pstnSummaryParams(
      parseNumberingListQuery(new URLSearchParams({ phoneQ: "__________" })).filters,
    );
    expect(params.get("filters.phoneNumber")).toBeNull();
    expect(params.toString()).not.toContain("dataset");
  });

  it("rejects more than 20 ABC values before calling PSTN", () => {
    const abc = Array.from({ length: 21 }, (_, index) => String(100 + index));
    expect(() =>
      parseNumberingListQuery(new URLSearchParams({ filters: JSON.stringify({ abc }) })),
    ).toThrow(NumberingQueryError);
  });

  it("rejects a value that would break the PSTN separator", () => {
    expect(() =>
      parseNumberingListQuery(
        new URLSearchParams({
          filters: JSON.stringify({ operator: ["a|||b"] }),
        }),
      ),
    ).toThrow(NumberingQueryError);
  });

  it("asks PSTN for one facet column and its search", () => {
    const query = parseNumberingFacetQuery(
      new URLSearchParams({
        column: "operator",
        q: "рост",
        dataset: "current",
        filters: JSON.stringify({ abc: ["499"] }),
      }),
    );
    const params = pstnFacetParams(query);
    expect(params.get("columns")).toBe("operator");
    expect(params.get("search.operator")).toBe("рост");
    expect(params.get("filters.abc")).toBe("499");
    expect(params.get("dataset")).toBeNull();
  });

  it("rejects a diff facet column", () => {
    expect(() =>
      parseNumberingFacetQuery(new URLSearchParams({ column: "changeStatus" })),
    ).toThrow(/колонка/);
  });
});
