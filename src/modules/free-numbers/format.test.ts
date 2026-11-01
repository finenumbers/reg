import { describe, expect, it } from "vitest";
import {
  displayFreeNumberFacet,
  displayProviderCode,
  facetSearchQuery,
  formatDidPrice,
  mapFreeNumberRow,
  priceFacetQuery,
  shapeFreeNumberFacets,
} from "@/modules/free-numbers/format";

describe("free-number display", () => {
  it("formats prices the way DID facets store them", () => {
    expect(formatDidPrice("1500.4")).toBe("1 500");
    expect(formatDidPrice(1500.5)).toBe("1 501");
    expect(formatDidPrice("-1.5")).toBe("-2");
    expect(formatDidPrice(null)).toBe("");
    expect(formatDidPrice("1 500")).toBe("1 500");
  });

  it("turns a digit price search into the spaced facet text", () => {
    expect(priceFacetQuery("1500")).toBe("1 500");
    expect(priceFacetQuery("1 500")).toBe("1 500");
    expect(priceFacetQuery("500")).toBe("500");
    expect(priceFacetQuery("Москва")).toBe("Москва");
    expect(facetSearchQuery("buy_price", "1500")).toBe("1 500");
    expect(facetSearchQuery("provider_code", "Telecom")).toBeNull();
    expect(facetSearchQuery("city_name", "50%")).toBe("50\\%");
  });

  it("labels providers and empty cells", () => {
    expect(displayProviderCode("aurora")).toBe("Aurora Telecom");
    expect(displayProviderCode("didww")).toBe("DIDWW");
    expect(displayFreeNumberFacet("provider_code", "mcn")).toBe("MCN Telecom");
    expect(displayFreeNumberFacet("city_name", "")).toBe("(пусто)");
    expect(displayFreeNumberFacet("city_name", "__empty__")).toBe("(пусто)");
  });

  it("drops hidden DID fields and keeps the visible row", () => {
    const row = mapFreeNumberRow({
      id: "abc",
      provider_code: "sipout",
      number_local: "1234567",
      buy_price: "2222.00",
      client: "Секрет",
      msisdn: "71234567890",
      provider_number_key: "key",
      rtu_connected: "да",
    });
    expect(row).toMatchObject({
      id: "abc",
      provider_code: "SipOut",
      number_local: "1234567",
      buy_price: "2 222",
      abc_code: "",
    });
    expect(row && "client" in row).toBe(false);
    expect(row && "msisdn" in row).toBe(false);
    expect(mapFreeNumberRow({ provider_code: "sipout" })).toBeNull();
  });

  it("filters provider labels locally and adds the empty bucket", () => {
    const shaped = shapeFreeNumberFacets({
      column: "provider_code",
      q: "telecom",
      items: [
        { value: "aurora", count: 4 },
        { value: "sipout", count: 9 },
      ],
      truncated: false,
      emptyCount: 2,
      limit: 200,
    });
    expect(shaped.items).toEqual([{ value: "aurora", count: 4 }]);
    expect(shaped.truncated).toBe(false);

    const empty = shapeFreeNumberFacets({
      column: "number_local",
      q: "(пусто)",
      items: [{ value: "123", count: 1 }],
      truncated: false,
      emptyCount: 7,
      limit: 200,
    });
    expect(empty.items[0]).toEqual({ value: "", count: 7 });
  });
});
