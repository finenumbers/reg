import { describe, expect, it } from "vitest";
import {
  aggregateFacetItems,
  encodeFilters,
  parseFiltersParam,
  setColumnFilterValues,
  removeFacetValue,
  toFilterToken,
  EMPTY_FILTER_TOKEN,
  facetQueryMatchesEmptyLabel,
} from "@/components/column-filters/types";

describe("column filter helpers", () => {
  it("encodes and parses filter maps", () => {
    expect(encodeFilters({})).toBeNull();
    const encoded = encodeFilters({ status: ["Registered"], phone: [] });
    expect(encoded).toBe(JSON.stringify({ status: ["Registered"] }));
    expect(parseFiltersParam(encoded)).toEqual({ status: ["Registered"] });
    expect(parseFiltersParam("not-json")).toEqual({});
  });

  it("normalizes empty tokens", () => {
    expect(toFilterToken("")).toBe(EMPTY_FILTER_TOKEN);
    expect(toFilterToken("x")).toBe("x");
  });

  it("updates and removes facet values", () => {
    let filters = setColumnFilterValues({}, "status", ["Registered"]);
    filters = setColumnFilterValues(filters, "phone", ["738"]);
    filters = removeFacetValue(filters, "status", "Registered");
    expect(filters).toEqual({ phone: ["738"] });
    filters = setColumnFilterValues(filters, "phone", []);
    expect(filters).toEqual({});
  });

  it("aggregates facet counts with search and limit", () => {
    const res = aggregateFacetItems(["a", "b", "a", "", null], {
      q: "a",
      limit: 10,
    });
    expect(res.items).toEqual([{ value: "a", count: 2 }]);
    expect(res.truncated).toBe(false);

    const empty = aggregateFacetItems(["", ""], { limit: 10 });
    expect(empty.items[0]?.value).toBe(EMPTY_FILTER_TOKEN);
    expect(empty.items[0]?.count).toBe(2);
  });

  it("matches empty-facet search labels without short fragments", () => {
    expect(facetQueryMatchesEmptyLabel("пусто")).toBe(true);
    expect(facetQueryMatchesEmptyLabel("(пусто)")).toBe(true);
    expect(facetQueryMatchesEmptyLabel("ПУСТО")).toBe(true);
    expect(facetQueryMatchesEmptyLabel("пуст")).toBe(true);
    expect(facetQueryMatchesEmptyLabel("7900")).toBe(false);
    expect(facetQueryMatchesEmptyLabel("о")).toBe(false);
    expect(facetQueryMatchesEmptyLabel("(")).toBe(false);
  });
});
