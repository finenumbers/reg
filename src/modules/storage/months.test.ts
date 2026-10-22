import { describe, expect, it } from "vitest";
import {
  deletableStorageMonthKey,
  mergeStorageMonths,
  type MonthTrafficStats,
} from "@/modules/storage/months";

const current = { year: 2026, month: 10, key: "2026-10" };

function side(key: string, calls: number, seconds = 0, minutes = 0): MonthTrafficStats {
  const [year, month] = key.split("-").map(Number);
  return { year: year!, month: month!, key, calls, seconds, minutes };
}

describe("mergeStorageMonths", () => {
  it("keeps an SMG-only month and makes it the oldest deletable month", () => {
    const merged = mergeStorageMonths(
      [side("2026-09", 10, 100, 2)],
      [side("2026-08", 4, 40, 1)],
      [],
      current,
    );
    expect(merged.map((row) => row.key)).toEqual(["2026-10", "2026-09", "2026-08"]);
    const august = merged.find((row) => row.key === "2026-08");
    expect(august).toMatchObject({ cdrCalls: 0, smgCalls: 4, count: 4 });
    expect(deletableStorageMonthKey(merged, current.key)).toBe("2026-08");
  });

  it("makes a syslog-only month the oldest deletable month", () => {
    const merged = mergeStorageMonths(
      [side("2026-09", 10)],
      [],
      [
        {
          year: 2026,
          month: 8,
          key: "2026-08",
          bytes: 0,
          files: 0,
          present: true,
        },
      ],
      current,
    );
    expect(merged.find((row) => row.key === "2026-08")).toMatchObject({
      cdrCalls: 0,
      smgCalls: 0,
      syslogBytes: 0,
      count: 1,
    });
    expect(deletableStorageMonthKey(merged, current.key)).toBe("2026-08");
  });

  it("makes a journal-only month the oldest deletable month and does not count delays alone", () => {
    const merged = mergeStorageMonths([side("2026-09", 10)], [], [], current, [
      { year: 2026, month: 8, key: "2026-08", journal: 3, cards: 0, delays: 0 },
      { year: 2026, month: 7, key: "2026-07", journal: 0, cards: 0, delays: 4 },
      { year: 2026, month: 6, key: "2026-06", journal: 0, cards: 0, delays: 0 },
    ]);
    expect(merged.find((row) => row.key === "2026-08")).toMatchObject({
      journal: 3,
      cards: 0,
      count: 3,
    });
    expect(merged.find((row) => row.key === "2026-07")).toMatchObject({
      delays: 4,
      count: 0,
    });
    expect(merged.find((row) => row.key === "2026-06")).toBeUndefined();
    expect(deletableStorageMonthKey(merged, current.key)).toBe("2026-08");
  });

  it("does not offer the current month", () => {
    const merged = mergeStorageMonths([], [side("2026-10", 3)], [], current);
    expect(deletableStorageMonthKey(merged, current.key)).toBeNull();
  });
});
