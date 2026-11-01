import { describe, expect, it } from "vitest";
import {
  allowPurchasedNumberFilters,
  parsePurchasedNumbersFacetQuery,
  parsePurchasedNumbersListQuery,
} from "@/modules/purchased-numbers/query";
import { FREE_NUMBERS_MAX_PAGE } from "@/modules/free-numbers/query";

describe("purchased-number query", () => {
  it("keeps client and RTU filters and drops hidden columns", () => {
    expect(
      allowPurchasedNumberFilters({
        client: ["Нет в РТУ"],
        rtu_connected: ["Не подключено"],
        msisdn: ["7"],
        provider_number_key: ["key"],
      }),
    ).toEqual({
      client: ["Нет в РТУ"],
      rtu_connected: ["Не подключено"],
    });
  });

  it("allows the client facet and rejects a hidden column", () => {
    expect(
      parsePurchasedNumbersFacetQuery(new URLSearchParams({ column: "client" })).column,
    ).toBe("client");
    expect(
      parsePurchasedNumbersFacetQuery(new URLSearchParams({ column: "rtu_connected" }))
        .column,
    ).toBe("rtu_connected");
    expect(() =>
      parsePurchasedNumbersFacetQuery(new URLSearchParams({ column: "msisdn" })),
    ).toThrow(/столбец/);
  });

  it("clamps the page the same way as free numbers", () => {
    expect(
      parsePurchasedNumbersListQuery(new URLSearchParams({ page: "999999" })).page,
    ).toBe(FREE_NUMBERS_MAX_PAGE);
  });
});
