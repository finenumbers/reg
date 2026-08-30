import { describe, expect, it } from "vitest";
import { EMPTY_FILTER_TOKEN } from "@/components/column-filters/types";
import {
  arrangeTrafficFacetItems,
  moveEmptyFacetLast,
  nextTimeSort,
  parseTimeSort,
  timeSortChevron,
  trafficFacetGroupOrder,
  trafficListOrderBy,
} from "@/modules/traffic/traffic-sort";

describe("parseTimeSort", () => {
  it("accepts only asc and desc", () => {
    expect(parseTimeSort("asc")).toBe("asc");
    expect(parseTimeSort("desc")).toBe("desc");
    expect(parseTimeSort("")).toBeNull();
    expect(parseTimeSort("up")).toBeNull();
    expect(parseTimeSort(null)).toBeNull();
  });
});

describe("nextTimeSort", () => {
  it("cycles null → desc → asc → null", () => {
    expect(nextTimeSort(null)).toBe("desc");
    expect(nextTimeSort("desc")).toBe("asc");
    expect(nextTimeSort("asc")).toBeNull();
  });
});

describe("trafficListOrderBy", () => {
  it("keeps newest-call order when sort is off", () => {
    expect(trafficListOrderBy(null)).toEqual([
      { cdrDate: "desc" },
      { cdrId: "desc" },
    ]);
  });

  it("sorts by clock then date in the same direction", () => {
    expect(trafficListOrderBy("asc")).toEqual([
      { cdrTime: "asc" },
      { cdrDate: "asc" },
      { cdrId: "asc" },
    ]);
    expect(trafficListOrderBy("desc")).toEqual([
      { cdrTime: "desc" },
      { cdrDate: "desc" },
      { cdrId: "desc" },
    ]);
  });
});

describe("moveEmptyFacetLast", () => {
  it("keeps ISO days and appends empty", () => {
    expect(
      moveEmptyFacetLast([
        { value: EMPTY_FILTER_TOKEN, count: 2 },
        { value: "2026-08-01", count: 4 },
        { value: "2026-08-02", count: 1 },
      ]),
    ).toEqual([
      { value: "2026-08-01", count: 4 },
      { value: "2026-08-02", count: 1 },
      { value: EMPTY_FILTER_TOKEN, count: 2 },
    ]);
  });
});

describe("trafficFacetGroupOrder", () => {
  it("lists Дата by increasing ISO day, other columns by count", () => {
    expect(trafficFacetGroupOrder("cdr_day")).toEqual({ cdrDay: "asc" });
    expect(trafficFacetGroupOrder("side_a")).toEqual({
      _count: { id: "desc" },
    });
    expect(trafficFacetGroupOrder("cdr_time")).toEqual({
      _count: { id: "desc" },
    });
  });
});

describe("arrangeTrafficFacetItems", () => {
  it("moves empty Дата values last and leaves other columns as grouped", () => {
    const items = [
      { value: EMPTY_FILTER_TOKEN, count: 2 },
      { value: "2026-08-31", count: 1 },
      { value: "2026-08-01", count: 3 },
    ];
    expect(arrangeTrafficFacetItems("cdr_day", items)).toEqual([
      { value: "2026-08-31", count: 1 },
      { value: "2026-08-01", count: 3 },
      { value: EMPTY_FILTER_TOKEN, count: 2 },
    ]);
    expect(arrangeTrafficFacetItems("side_a", items)).toEqual(items);
  });
});

describe("timeSortChevron", () => {
  it("stays neutral until Time sort is on", () => {
    expect(timeSortChevron(null)).toBe("↕");
    expect(timeSortChevron("desc")).toBe("▾");
    expect(timeSortChevron("asc")).toBe("▴");
  });
});
