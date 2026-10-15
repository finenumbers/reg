import { describe, expect, it } from "vitest";
import { fillConcurrencyMinutes, utcCallDay, type MinuteEventRow } from "./concurrency";

function row(partial: MinuteEventRow): MinuteEventRow {
  return partial;
}

describe("utcCallDay", () => {
  it("keeps the civil UTC day and includes the open minute", () => {
    const day = utcCallDay(new Date("2026-10-16T14:22:30.000Z"));
    expect(day.day).toBe("2026-10-16");
    expect(day.dayStart.toISOString()).toBe("2026-10-16T00:00:00.000Z");
    expect(day.dayEnd.toISOString()).toBe("2026-10-17T00:00:00.000Z");
    expect(day.lookbackStart.toISOString()).toBe("2026-10-15T00:00:00.000Z");
    expect(day.seriesEnd.toISOString()).toBe("2026-10-16T14:23:00.000Z");
    expect(day.minuteCount).toBe(14 * 60 + 22 + 1);
  });

  it("starts the new day on a single open minute", () => {
    const day = utcCallDay(new Date("2026-10-16T00:00:00.000Z"));
    expect(day.minuteCount).toBe(1);
    expect(day.seriesEnd.toISOString()).toBe("2026-10-16T00:01:00.000Z");
  });

  it("covers every minute of a day that is about to end", () => {
    const day = utcCallDay(new Date("2026-10-16T23:59:59.999Z"));
    expect(day.minuteCount).toBe(1440);
    expect(day.seriesEnd.toISOString()).toBe("2026-10-17T00:00:00.000Z");
  });
});

describe("fillConcurrencyMinutes", () => {
  it("carries a long call across minutes that have no events", () => {
    const series = fillConcurrencyMinutes(11, 0, [
      row({ minute: 0, peak: 1, levelAtEnd: 1, touchesStart: true }),
      row({ minute: 10, peak: 0, levelAtEnd: 0, touchesStart: true }),
    ]);
    expect(series).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
  });

  it("counts a call that starts and ends inside one minute", () => {
    const series = fillConcurrencyMinutes(5, 0, [
      row({ minute: 3, peak: 1, levelAtEnd: 0, touchesStart: false }),
    ]);
    expect(series).toEqual([0, 0, 0, 1, 0]);
  });

  it("keeps the level from before a drop that happens after the minute opens", () => {
    const series = fillConcurrencyMinutes(3, 0, [
      row({ minute: 0, peak: 4, levelAtEnd: 4, touchesStart: true }),
      row({ minute: 1, peak: 1, levelAtEnd: 1, touchesStart: false }),
    ]);
    expect(series).toEqual([4, 4, 1]);
  });

  it("does not count a call that ends on the exact minute boundary", () => {
    const series = fillConcurrencyMinutes(6, 1, [
      row({ minute: 5, peak: 0, levelAtEnd: 0, touchesStart: true }),
    ]);
    expect(series).toEqual([1, 1, 1, 1, 1, 0]);
  });

  it("holds occupancy that was already active at midnight", () => {
    expect(fillConcurrencyMinutes(3, 2, [])).toEqual([2, 2, 2]);
  });

  it("omits minutes after the requested length", () => {
    const series = fillConcurrencyMinutes(2, 0, [
      row({ minute: 0, peak: 3, levelAtEnd: 3, touchesStart: true }),
      row({ minute: 5, peak: 9, levelAtEnd: 9, touchesStart: true }),
    ]);
    expect(series).toEqual([3, 3]);
  });

  it("does not draw a negative level", () => {
    const series = fillConcurrencyMinutes(2, -3, [
      row({ minute: 1, peak: -1, levelAtEnd: -4, touchesStart: false }),
    ]);
    expect(series).toEqual([0, 0]);
  });
});
