import { describe, expect, it } from "vitest";
import { parseMonthKey, zonedMonth, zonedMonthRange } from "@/modules/antifraud/month";

describe("zoned month", () => {
  it("uses UTC month boundaries, including the evening that is still October in UTC", () => {
    expect(zonedMonth(new Date("2026-10-31T21:30:00.000Z"), "UTC").key).toBe("2026-10");
    const range = zonedMonthRange(2026, 10, "UTC");
    expect(range.start.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("rejects a month key that is not YYYY-MM", () => {
    expect(parseMonthKey("2026-10")).toEqual({ year: 2026, month: 10 });
    expect(parseMonthKey("2026-13")).toBeNull();
    expect(parseMonthKey("October")).toBeNull();
  });
});
