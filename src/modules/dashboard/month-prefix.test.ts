import { describe, expect, it } from "vitest";
import { monthPrefixBounds, parseDashboardCount } from "@/modules/dashboard/month-prefix";

describe("monthPrefixBounds", () => {
  it("uses the month key and the next month key", () => {
    expect(monthPrefixBounds({ year: 2026, month: 11, key: "2026-11" })).toEqual({
      start: "2026-11",
      end: "2026-12",
    });
  });

  it("rolls December into the next year", () => {
    expect(monthPrefixBounds({ year: 2026, month: 12, key: "2026-12" })).toEqual({
      start: "2026-12",
      end: "2027-01",
    });
  });
});

describe("parseDashboardCount", () => {
  it("keeps a real zero", () => {
    expect(parseDashboardCount(0)).toBe(0);
    expect(parseDashboardCount(BigInt(0))).toBe(0);
    expect(parseDashboardCount("0")).toBe(0);
  });

  it("keeps a safe integer", () => {
    expect(parseDashboardCount(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseDashboardCount(BigInt(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("rejects a gap", () => {
    expect(parseDashboardCount(1.5)).toBeNull();
    expect(parseDashboardCount(-1)).toBeNull();
    expect(parseDashboardCount(BigInt(-1))).toBeNull();
    expect(parseDashboardCount("")).toBeNull();
    expect(parseDashboardCount(null)).toBeNull();
    expect(parseDashboardCount(undefined)).toBeNull();
    expect(parseDashboardCount(BigInt(2) ** BigInt(53))).toBeNull();
    expect(parseDashboardCount(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    expect(parseDashboardCount("12.5")).toBeNull();
    expect(parseDashboardCount(true)).toBeNull();
  });
});
