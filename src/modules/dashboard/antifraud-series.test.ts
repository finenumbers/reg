import { describe, expect, it } from "vitest";
import { AF_CATEGORY } from "@/modules/smg-trace/classify";
import {
  buildAnswerLines,
  buildDelayLines,
  envelopeMinutes,
  lineSegments,
  linesPeak,
  widenedSetupBounds,
  zoneCacheKey,
} from "@/modules/dashboard/antifraud-series";
import { utcCallWindow } from "@/modules/dashboard/concurrency";

describe("widenedSetupBounds", () => {
  it("extends the string window by the largest curated offset", () => {
    const afternoon = utcCallWindow(new Date("2026-10-16T14:22:30.000Z"));
    expect(widenedSetupBounds(afternoon)).toEqual({
      start: "2026-10-16 00:00:00",
      end: "2026-10-16 21:23:00",
    });
  });

  it("reaches into the previous day when the two-hour window does", () => {
    const midnight = utcCallWindow(new Date("2026-10-16T00:30:00.000Z"));
    expect(widenedSetupBounds(midnight)).toEqual({
      start: "2026-10-15 22:31:00",
      end: "2026-10-16 07:31:00",
    });
  });
});

describe("zoneCacheKey", () => {
  it("ignores a node without an identifier and sorts the rest", () => {
    expect(
      zoneCacheKey([
        { identifier: "mts", cdrTimezone: "UTC" },
        { identifier: null, cdrTimezone: "Europe/Moscow" },
        { identifier: "kazan", cdrTimezone: "Europe/Moscow" },
      ]),
    ).toBe("kazan=Europe/Moscow|mts=UTC");
  });
});

describe("lineSegments", () => {
  it("keeps a measured zero and breaks on an empty minute", () => {
    expect(lineSegments([1, null, 0, 2])).toEqual([
      { from: 0, to: 1 },
      { from: 2, to: 4 },
    ]);
    expect(lineSegments([null, null])).toEqual([]);
  });
});

describe("answer and delay lines", () => {
  it("drops an all-zero category and keeps the category order", () => {
    const lines = buildAnswerLines(3, [
      { category: AF_CATEGORY.passed, minute: 1, count: 2 },
      { category: AF_CATEGORY.noData, minute: 0, count: 4 },
      { category: "Свой вердикт", minute: 2, count: 1 },
    ]);
    expect(lines.map((line) => line.label)).toEqual([
      AF_CATEGORY.noData,
      AF_CATEGORY.passed,
      "Свой вердикт",
    ]);
    expect(lines[0]?.total).toBe(4);
    expect(lines[0]?.minutes).toEqual([4, 0, 0]);
    expect(linesPeak(lines)).toBe(4);
  });

  it("leaves a minute with no delay sample empty and keeps a zero", () => {
    const lines = buildDelayLines(3, [
      { line: "dev", minute: 0, mean: 0 },
      { line: "prod", minute: 2, mean: 40 },
    ]);
    expect(lines.map((line) => line.minutes)).toEqual([
      [0, null, null],
      [null, null, 40],
      [null, null, null],
    ]);
    expect(lines.every((line) => line.total == null)).toBe(true);
    expect(envelopeMinutes(lines, 3)).toEqual([0, 0, 40]);
    expect(linesPeak(lines)).toBe(40);
  });
});
