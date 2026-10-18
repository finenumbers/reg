import { describe, expect, it } from "vitest";
import {
  deletableStorageMonthKey,
  mergeStorageMonths,
  type MonthTrafficStats,
} from "@/modules/storage/months";

const current = { year: 2026, month: 10, key: "2026-10" };

function side(
  key: string,
  calls: number,
  seconds = 0,
  minutes = 0,
): MonthTrafficStats {
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

  it("does not offer the current month", () => {
    const merged = mergeStorageMonths([], [side("2026-10", 3)], [], current);
    expect(deletableStorageMonthKey(merged, current.key)).toBeNull();
  });
});