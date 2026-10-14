import { describe, expect, it } from "vitest";
import { smgMonthDayRange, smgMonthTimeRange } from "@/modules/smg/month-range";
import { parseMonthKey } from "@/modules/traffic/cdr-month";

describe("smgMonthTimeRange", () => {
  it("covers October through the first instant of November", () => {
    const month = parseMonthKey("2026-10");
    expect(month).not.toBeNull();
    expect(smgMonthTimeRange(month!)).toEqual({
      gte: "2026-10-01 00:00:00",
      lt: "2026-11-01 00:00:00",
    });
  });

  it("rolls December into January of the next year", () => {
    const month = parseMonthKey("2026-12");
    expect(month).not.toBeNull();
    expect(smgMonthTimeRange(month!)).toEqual({
      gte: "2026-12-01 00:00:00",
      lt: "2027-01-01 00:00:00",
    });
  });
});

describe("smgMonthDayRange", () => {
  it("uses the civil day stored in disconnect_day", () => {
    const month = parseMonthKey("2026-12");
    expect(month).not.toBeNull();
    expect(smgMonthDayRange(month!)).toEqual({
      gte: "2026-12-01",
      lt: "2027-01-01",
    });
  });
});
