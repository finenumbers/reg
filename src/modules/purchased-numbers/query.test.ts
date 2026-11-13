import { describe, expect, it } from "vitest";
import {
  PURCHASED_NUMBERS_MAX_FILTERS_CHARS,
  PURCHASED_NUMBERS_MAX_QUERY_CHARS,
  allowPurchasedNumberFilters,
  parsePurchasedNumbersFacetQuery,
  parsePurchasedNumbersListQuery,
} from "@/modules/purchased-numbers/query";

describe("purchased-number query allowlist", () => {
  it("keeps client and drops a free-number amount column", () => {
    const params = new URLSearchParams({
      page: "99999",
      pageSize: "500",
      phoneQ: " 495 ",
      filters: JSON.stringify({
        client: ["Секрет"],
        incomingPurchase: ["10"],
        msisdn: ["7"],
        region: ["Москва"],
        provider: ["aurora"],
      }),
    });
    expect(parsePurchasedNumbersListQuery(params)).toEqual({
      page: 2000,
      pageSize: 100,
      phoneQ: "495",
      filters: {
        client: ["Секрет"],
        region: ["Москва"],
        provider: ["aurora"],
      },
    });
  });

  it("rejects an unknown facet column and a huge filter", () => {
    expect(() =>
      parsePurchasedNumbersFacetQuery(new URLSearchParams({ column: "incomingPurchase" })),
    ).toThrow(/столбец/);
    expect(() =>
      parsePurchasedNumbersFacetQuery(new URLSearchParams({ column: "msisdn" })),
    ).toThrow(/столбец/);
    const huge = new URLSearchParams({
      filters: "x".repeat(PURCHASED_NUMBERS_MAX_FILTERS_CHARS + 1),
    });
    expect(() => parsePurchasedNumbersListQuery(huge)).toThrow(/фильтр/);
    expect(() =>
      parsePurchasedNumbersListQuery(
        new URLSearchParams({ phoneQ: "1".repeat(PURCHASED_NUMBERS_MAX_QUERY_CHARS + 1) }),
      ),
    ).toThrow(/поисковый/);
  });

  it("keeps a visible column and drops a hidden one", () => {
    expect(
      allowPurchasedNumberFilters({
        client: ["Секрет"],
        incomingPurchase: ["скрыто"],
      }),
    ).toEqual({ client: ["Секрет"] });
  });

  it("accepts a visible facet column", () => {
    expect(
      parsePurchasedNumbersFacetQuery(
        new URLSearchParams({ column: "client", q: "пусто", limit: "5000" }),
      ),
    ).toMatchObject({ column: "client", q: "пусто", limit: 1000 });
    expect(
      parsePurchasedNumbersFacetQuery(new URLSearchParams({ column: "number" })).column,
    ).toBe("number");
  });
});
