import { describe, expect, it } from "vitest";
import {
  FREE_NUMBERS_MAX_FILTERS_CHARS,
  FREE_NUMBERS_MAX_QUERY_CHARS,
  allowFreeNumberFilters,
  parseFreeNumbersFacetQuery,
  parseFreeNumbersListQuery,
} from "@/modules/free-numbers/query";

describe("free-number query allowlist", () => {
  it("drops hidden columns and clamps the page", () => {
    const params = new URLSearchParams({
      page: "99999",
      pageSize: "500",
      phoneQ: " 495 ",
      filters: JSON.stringify({
        client: ["Секрет"],
        msisdn: ["7"],
        region: ["Москва"],
        provider: ["aurora"],
      }),
    });
    expect(parseFreeNumbersListQuery(params)).toEqual({
      page: 2000,
      pageSize: 100,
      phoneQ: "495",
      filters: {
        region: ["Москва"],
        provider: ["aurora"],
      },
    });
  });

  it("rejects an unknown facet column and a huge filter", () => {
    expect(() =>
      parseFreeNumbersFacetQuery(new URLSearchParams({ column: "client" })),
    ).toThrow(/столбец/);
    expect(() =>
      parseFreeNumbersFacetQuery(new URLSearchParams({ column: "msisdn" })),
    ).toThrow(/столбец/);
    expect(() =>
      parseFreeNumbersFacetQuery(new URLSearchParams({ column: "buy_price" })),
    ).toThrow(/столбец/);
    const huge = new URLSearchParams({
      filters: "x".repeat(FREE_NUMBERS_MAX_FILTERS_CHARS + 1),
    });
    expect(() => parseFreeNumbersListQuery(huge)).toThrow(/фильтр/);
    expect(() =>
      parseFreeNumbersListQuery(
        new URLSearchParams({ phoneQ: "1".repeat(FREE_NUMBERS_MAX_QUERY_CHARS + 1) }),
      ),
    ).toThrow(/поисковый/);
  });

  it("keeps a visible column and drops a hidden one", () => {
    expect(
      allowFreeNumberFilters({
        city: ["Казань"],
        client: ["скрыто"],
      }),
    ).toEqual({ city: ["Казань"] });
  });

  it("accepts a visible facet column", () => {
    expect(
      parseFreeNumbersFacetQuery(
        new URLSearchParams({ column: "number", q: "пусто", limit: "5000" }),
      ),
    ).toMatchObject({ column: "number", q: "пусто", limit: 1000 });
    expect(
      parseFreeNumbersFacetQuery(
        new URLSearchParams({ column: "incomingPurchase" }),
      ).column,
    ).toBe("incomingPurchase");
  });
});
