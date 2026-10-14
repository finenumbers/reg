import { describe, expect, it } from "vitest";
import {
  applyMonthFilter,
  currentUtcMonth,
  deletableMonthKey,
  monthKeyFromCdrDay,
  parseMonthKey,
  resolveMonthKey,
  sumMonthRecordCounts,
  withCurrentMonth,
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

describe("monthKeyFromCdrDay", () => {
  it("reads YYYY-MM from Дата", () => {
    expect(monthKeyFromCdrDay("2026-08-30")?.key).toBe("2026-08");
  });
});

describe("deletableMonthKey", () => {
  it("picks the oldest complete month", () => {
    expect(
      deletableMonthKey(
        [
          { key: "2026-08", count: 10 },
          { key: "2026-07", count: 5 },
          { key: "2026-01", count: 2 },
        ],
        "2026-08",
      ),
    ).toBe("2026-01");
  });

  it("returns null when only the current month has rows", () => {
    expect(
      deletableMonthKey([{ key: "2026-08", count: 10 }], "2026-08"),
    ).toBeNull();
  });
});

describe("withCurrentMonth", () => {
  it("prepends the current month when missing", () => {
    const current = { year: 2026, month: 8, key: "2026-08" };
    expect(withCurrentMonth([{ year: 2026, month: 7, key: "2026-07", count: 3 }], current)).toEqual([
      { ...current, count: 0 },
      { year: 2026, month: 7, key: "2026-07", count: 3 },
    ]);
  });
});

describe("sumMonthRecordCounts", () => {
  it("sums stored month counts and treats a missing count as 0", () => {
    expect(
      sumMonthRecordCounts([
        { count: 10 },
        { count: 0 },
        {},
        { count: 3 },
      ]),
    ).toBe(13);
  });

  it("is 0 for an empty list", () => {
    expect(sumMonthRecordCounts([])).toBe(0);
  });
});
