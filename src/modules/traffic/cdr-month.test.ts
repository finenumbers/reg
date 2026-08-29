import { describe, expect, it } from "vitest";
import {
  applyMonthFilter,
  currentUtcMonth,
  monthsFromCdrDateBounds,
  parseMonthKey,
  resolveMonthKey,
} from "@/modules/traffic/cdr-month";

describe("parseMonthKey", () => {
  it("accepts YYYY-MM", () => {
    expect(parseMonthKey("2026-08")).toEqual({
      year: 2026,
      month: 8,
      key: "2026-08",
    });
  });

  it("rejects short month, day suffix, and month 13", () => {
    expect(parseMonthKey("2026-8")).toBeNull();
    expect(parseMonthKey("2026-08-01")).toBeNull();
    expect(parseMonthKey("2026-13")).toBeNull();
    expect(parseMonthKey("")).toBeNull();
  });
});

describe("currentUtcMonth / resolveMonthKey", () => {
  it("reads the UTC calendar month", () => {
    expect(currentUtcMonth(new Date("2026-08-29T22:00:00.000Z"))).toEqual({
      year: 2026,
      month: 8,
      key: "2026-08",
    });
  });

  it("falls back to current when the key is invalid", () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    expect(resolveMonthKey("nope", now).key).toBe("2026-08");
    expect(resolveMonthKey("2026-07", now).key).toBe("2026-07");
  });
});

describe("applyMonthFilter", () => {
  it("uses cdr_date prefix", () => {
    expect(applyMonthFilter(2026, 8)).toEqual({
      cdrDate: { startsWith: "2026-08-" },
    });
  });
});

describe("monthsFromCdrDateBounds", () => {
  const current = { year: 2026, month: 8, key: "2026-08" };

  it("fills from last CDR through the current month", () => {
    expect(
      monthsFromCdrDateBounds("2026-06-15 10:00:00", "2026-06-20 12:00:00", current).map(
        (m) => m.key,
      ),
    ).toEqual(["2026-08", "2026-07", "2026-06"]);
  });

  it("extends past current when CDR is in the future", () => {
    expect(
      monthsFromCdrDateBounds("2026-08-01 00:00:00", "2026-09-02 00:00:00", current).map(
        (m) => m.key,
      ),
    ).toEqual(["2026-09", "2026-08"]);
  });

  it("is only the current month when bounds are empty or junk", () => {
    expect(monthsFromCdrDateBounds(null, null, current)).toEqual([current]);
    expect(monthsFromCdrDateBounds("", "not-a-date", current)).toEqual([current]);
  });
});
