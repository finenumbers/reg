import { describe, expect, it } from "vitest";
import { cdrMonthPrefix, utcCalendarMonth } from "@/lib/month-window";

describe("utcCalendarMonth", () => {
  it("reads the UTC calendar month", () => {
    const now = new Date("2026-08-29T03:00:00.000Z");
    expect(utcCalendarMonth(now)).toEqual({ year: 2026, month: 8 });
  });
});

describe("cdrMonthPrefix", () => {
  it("pads the month and keeps the trailing hyphen", () => {
    expect(cdrMonthPrefix(2026, 6)).toBe("2026-06-");
    expect(cdrMonthPrefix(2026, 7)).toBe("2026-07-");
  });

  it("rejects a month outside 1–12", () => {
    expect(() => cdrMonthPrefix(2026, 0)).toThrow(/Некорректный месяц/);
    expect(() => cdrMonthPrefix(2026, 13)).toThrow(/Некорректный месяц/);
  });
});
