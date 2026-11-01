import { describe, expect, it } from "vitest";
import { NumberingClientError } from "@/modules/numbering-resource/errors";
import {
  mapFacetsBody,
  mapRangesBody,
  mapSummaryBody,
} from "@/modules/numbering-resource/map";

const range = {
  id: 7,
  abc: "495",
  rangeStart: 1000000,
  rangeEnd: 1000099,
  capacity: 100,
  operator: "Оператор",
  garTerritory: "Москва",
  inn: "7700000000",
  uvrAntifraud: null,
  changeType: "added",
  prevOperator: "Старый",
  abcRangeGapBefore: true,
};

describe("numbering PSTN response mapping", () => {
  it("keeps current-dataset columns and the unknown phone total", () => {
    const mapped = mapRangesBody({
      data: [range],
      meta: { pageSize: 100, totalRows: -1, hasMore: true, sort: [] },
    });
    expect(mapped.total).toBe(-1);
    expect(mapped.hasMore).toBe(true);
    expect(mapped.items[0]).toEqual({
      id: 7,
      abc: "495",
      rangeStart: 1000000,
      rangeEnd: 1000099,
      capacity: 100,
      operator: "Оператор",
      garTerritory: "Москва",
      inn: "7700000000",
      uvrAntifraud: null,
    });
    expect(mapped.items[0]).not.toHaveProperty("changeType");
    expect(mapped.items[0]).not.toHaveProperty("prevOperator");
  });

  it("rejects a row that cannot keyset", () => {
    expect(() =>
      mapRangesBody({
        data: [{ ...range, id: 0 }],
        meta: { totalRows: 1, hasMore: false },
      }),
    ).toThrow(NumberingClientError);
  });

  it("marks a short facet page as truncated and keeps a zero count", () => {
    const facets = mapFacetsBody(
      {
        facets: {
          operator: {
            options: [
              { value: "А", count: 2, selected: false },
              { value: "", count: 0, selected: true },
            ],
            totalDistinct: 40,
          },
        },
      },
      "operator",
    );
    expect(facets.truncated).toBe(true);
    expect(facets.items).toEqual([
      { value: "А", count: 2 },
      { value: "", count: 0 },
    ]);
  });

  it("reads a pending capacity summary", () => {
    const summary = mapSummaryBody({
      filtered: {
        rangeCount: 20_000,
        totalCapacity: 0,
        totalCapacityPending: true,
        uniqueGarTerritories: 3,
        uniqueOperators: 4,
      },
      global: {
        rangeCount: 446_000,
        totalCapacity: 1_000_000,
        uniqueGarTerritories: 80,
        uniqueOperators: 90,
      },
    });
    expect(summary.filtered.totalCapacityPending).toBe(true);
    expect(summary.global.rangeCount).toBe(446_000);
  });
});
