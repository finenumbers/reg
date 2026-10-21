import { describe, expect, it } from "vitest";
import { parseMonthKey, zonedMonth, zonedMonthRange } from "@/modules/antifraud/month";

describe("zoned month", () => {
  it("uses the operator timezone, including the month that starts the evening before in UTC", () => {
    expect(zonedMonth(new Date("2026-10-31T21:30:00.000Z"), "Europe/Moscow").key).toBe(
      "2026-11",
    );
    const range = zonedMonthRange(2026, 10, "Europe/Moscow");
    expect(range.start.toISOString()).toBe("2026-09-30T21:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-10-31T21:00:00.000Z");
  });

  it("rejects a month key that is not YYYY-MM", () => {
    expect(parseMonthKey("2026-10")).toEqual({ year: 2026, month: 10 });
    expect(parseMonthKey("2026-13")).toBeNull();
    expect(parseMonthKey("October")).toBeNull();
  });
});
