import { describe, expect, it } from "vitest";
import {
  axisCeiling,
  axisTickTop,
  axisTicks,
  eventCountLabel,
  fillConcurrencyMinutes,
  fillEventCounts,
  formatTrafficDayTitle,
  formatUtcMinute,
  provisionalMinuteIndex,
  sessionCountLabel,
  utcCallDay,
  utcCallWindow,
  type MinuteEventRow,
} from "./concurrency";

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

describe("utcCallWindow", () => {
  it("opens two hours before the shared end and keeps the day lookback", () => {
    const window = utcCallWindow(new Date("2026-10-16T14:22:30.000Z"));
    expect(window.seriesEnd.toISOString()).toBe("2026-10-16T14:23:00.000Z");
    expect(window.recentStart.toISOString()).toBe("2026-10-16T12:23:00.000Z");
    expect(window.seriesEnd.getTime() - window.recentStart.getTime()).toBe(
      2 * 60 * 60 * 1000,
    );
    expect(window.scanStart.toISOString()).toBe("2026-10-15T00:00:00.000Z");
  });

  it("reaches into the previous evening at 00:10", () => {
    const window = utcCallWindow(new Date("2026-10-16T00:10:00.000Z"));
    expect(window.recentStart.toISOString()).toBe("2026-10-15T22:11:00.000Z");
    expect(window.seriesEnd.toISOString()).toBe("2026-10-16T00:11:00.000Z");
    expect(window.scanStart.toISOString()).toBe("2026-10-14T22:11:00.000Z");
    expect(formatUtcMinute(window.recentStart, 0)).toBe("22:11");
    expect(formatUtcMinute(window.recentStart, 119)).toBe("00:10");
  });

  it("keeps two hours when the day itself has only the midnight minute", () => {
    const window = utcCallWindow(new Date("2026-10-16T00:00:00.000Z"));
    expect(window.minuteCount).toBe(1);
    expect(window.recentStart.toISOString()).toBe("2026-10-15T22:01:00.000Z");
    expect(window.seriesEnd.toISOString()).toBe("2026-10-16T00:01:00.000Z");
    expect(formatUtcMinute(window.recentStart, 119)).toBe("00:00");
  });
});

describe("formatTrafficDayTitle", () => {
  it("writes the UTC civil date and the Russian weekday", () => {
    expect(formatTrafficDayTitle("2026-10-16")).toBe("16.10.2026 (пятница)");
    expect(formatTrafficDayTitle("2026-10-18")).toBe("18.10.2026 (воскресенье)");
  });

  it("rejects a day that is not on the calendar", () => {
    expect(formatTrafficDayTitle("2026-02-31")).toBeNull();
    expect(formatTrafficDayTitle("2026-13-01")).toBeNull();
    expect(formatTrafficDayTitle("16.10.2026")).toBeNull();
  });
});

describe("provisionalMinuteIndex", () => {
  it("paints the last 60 filled minutes, and a short series from the start", () => {
    expect(provisionalMinuteIndex(863)).toBe(803);
    expect(provisionalMinuteIndex(31)).toBe(0);
    expect(provisionalMinuteIndex(120)).toBe(60);
    expect(provisionalMinuteIndex(0)).toBe(0);
    expect(provisionalMinuteIndex(Number.NaN)).toBe(0);
  });
});

describe("axis scale", () => {
  it("keeps a zero peak on the baseline", () => {
    expect(axisCeiling(0)).toBe(0);
    expect(axisTicks(0)).toEqual([0]);
    expect(axisTickTop(0, 0)).toBe(98);
  });

  it("uses a 1-2-5 ceiling and skips a fractional middle", () => {
    expect(axisCeiling(1)).toBe(1);
    expect(axisTicks(1)).toEqual([1, 0]);
    expect(axisCeiling(3)).toBe(5);
    expect(axisTicks(3)).toEqual([5, 0]);
    expect(axisCeiling(5)).toBe(5);
    expect(axisTickTop(5, 5)).toBe(6);
    expect(axisTickTop(0, 5)).toBe(98);
  });
});

describe("eventCountLabel", () => {
  it("declines the event word", () => {
    expect(eventCountLabel(0)).toBe("0 событий");
    expect(eventCountLabel(1)).toBe("1 событие");
    expect(eventCountLabel(2)).toBe("2 события");
    expect(eventCountLabel(5)).toBe("5 событий");
    expect(eventCountLabel(11)).toBe("11 событий");
    expect(eventCountLabel(21)).toBe("21 событие");
    expect(eventCountLabel(22)).toBe("22 события");
  });
});

describe("fillEventCounts", () => {
  it("keeps a quiet minute at zero between two events", () => {
    expect(
      fillEventCounts(4, [
        { minute: 0, count: 4 },
        { minute: 2, count: 1 },
      ]),
    ).toEqual([4, 0, 1, 0]);
  });

  it("drops minutes outside the requested length and negative counts", () => {
    expect(
      fillEventCounts(2, [
        { minute: -1, count: 9 },
        { minute: 0, count: 3 },
        { minute: 5, count: 8 },
        { minute: 1, count: -2 },
      ]),
    ).toEqual([3, 0]);
  });
});

describe("sessionCountLabel", () => {
  it("declines the session word", () => {
    expect(sessionCountLabel(0)).toBe("0 сессий");
    expect(sessionCountLabel(1)).toBe("1 сессия");
    expect(sessionCountLabel(2)).toBe("2 сессии");
    expect(sessionCountLabel(5)).toBe("5 сессий");
    expect(sessionCountLabel(11)).toBe("11 сессий");
    expect(sessionCountLabel(12)).toBe("12 сессий");
    expect(sessionCountLabel(21)).toBe("21 сессия");
    expect(sessionCountLabel(111)).toBe("111 сессий");
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
