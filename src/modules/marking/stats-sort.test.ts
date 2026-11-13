import { describe, expect, it } from "vitest";
import { sortMarkingStatsRows, type MarkingStatsRow } from "@/modules/marking/stats-sort";
import {
  blockedToken,
  markingStatsMonth,
  markingStatsRowFromCounts,
  statsCacheAccepted,
  toneToken,
  MarkingStatsError,
} from "@/modules/marking/stats";

function row(
  patch: Partial<MarkingStatsRow> & Pick<MarkingStatsRow, "client">,
): MarkingStatsRow {
  return {
    numbers: 1,
    mts: 0,
    megafon: 0,
    beeline: 0,
    t2: 0,
    external: 0,
    total: 0,
    ...patch,
  };
}

describe("marking stats rows", () => {
  it("stores the total as the sum of the five networks", () => {
    const item = markingStatsRowFromCounts({
      client: "А",
      numbers: 4,
      mts: 1,
      megafon: 2,
      beeline: 0,
      t2: 3,
      external: 4,
    });
    expect(item.total).toBe(10);
    expect(() =>
      markingStatsRowFromCounts({
        client: "А",
        numbers: -1,
        mts: 0,
        megafon: 0,
        beeline: 0,
        t2: 0,
        external: 0,
      }),
    ).toThrow(MarkingStatsError);
  });

  it("sorts clients by name until a network column is chosen", () => {
    const rows = [
      row({ client: "Я", mts: 3, external: 9, total: 12 }),
      row({ client: "А", mts: 3, external: 1, total: 4 }),
      row({ client: "Б", mts: 8, total: 8 }),
    ];
    expect(sortMarkingStatsRows(rows, null).map((item) => item.client)).toEqual([
      "А",
      "Б",
      "Я",
    ]);
    expect(sortMarkingStatsRows(rows, "mts").map((item) => item.client)).toEqual([
      "Б",
      "А",
      "Я",
    ]);
    expect(sortMarkingStatsRows(rows, "external").map((item) => item.client)).toEqual([
      "Я",
      "А",
      "Б",
    ]);
    expect(sortMarkingStatsRows(rows, "total").map((item) => item.client)).toEqual([
      "Я",
      "Б",
      "А",
    ]);
    const tied = [
      row({ client: "Я", total: 5 }),
      row({ client: "А", total: 5 }),
      row({ client: "Б", total: 1 }),
    ];
    expect(sortMarkingStatsRows(tied, "total").map((item) => item.client)).toEqual([
      "А",
      "Я",
      "Б",
    ]);
  });

  it("rejects a bad month and keeps a snapshot only while the data generation holds", () => {
    expect(markingStatsMonth(null, new Date("2026-11-13T00:00:00.000Z")).key).toBe(
      "2026-11",
    );
    expect(markingStatsMonth("2026-05").key).toBe("2026-05");
    expect(() => markingStatsMonth("2026-13")).toThrow(MarkingStatsError);
    expect(() => markingStatsMonth("soon")).toThrow(MarkingStatsError);
    expect(
      statsCacheAccepted({
        generationAtStart: 4,
        generationAtEnd: 4,
        revisionAtStart: 2,
        revisionAtEnd: 2,
      }),
    ).toBe(true);
    expect(
      statsCacheAccepted({
        generationAtStart: 4,
        generationAtEnd: 5,
        revisionAtStart: 2,
        revisionAtEnd: 2,
      }),
    ).toBe(false);
    expect(toneToken({ Бета: "red", Альфа: "green" })).toBe("green:Альфа\nred:Бета");
    expect(blockedToken("stamp", { exact: new Set(["1"]), pstn: new Set() })).toBe(
      "stamp:1:0",
    );
  });
});
