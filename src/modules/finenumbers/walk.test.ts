import { describe, expect, it } from "vitest";

import { FINENUMBERS_INN } from "@/modules/finenumbers/expand";
import { readInnRanges } from "@/modules/finenumbers/walk";
import type { NumberingRow, NumberingSummary } from "@/modules/numbering-resource/types";

function row(partial: Partial<NumberingRow> & Pick<NumberingRow, "id" | "rangeStart" | "rangeEnd" | "capacity">): NumberingRow {
  return {
    abc: "495",
    operator: "Finenumbers",
    garTerritory: "Москва",
    legalAddress: null,
    inn: FINENUMBERS_INN,
    uvrAntifraud: null,
    abcRangeGapBefore: false,
    abcRangeGapAfter: true,
    ...partial,
  };
}

function summary(rangeCount: number, totalCapacity: number, pending = false): NumberingSummary {
  const counts = {
    rangeCount,
    totalCapacity,
    uniqueGarTerritories: 1,
    uniqueOperators: 1,
  };
  return {
    loadedAt: "2026-11-17T00:00:00.000Z",
    filtered: { ...counts, totalCapacityPending: pending },
    global: counts,
  };
}

describe("Finenumbers range read", () => {
  it("keeps a complete list and ignores a display gap", async () => {
    const pages = [
      {
        items: [row({ id: 1, rangeStart: 1_000_000, rangeEnd: 1_000_099, capacity: 100 })],
        total: 2,
        hasMore: true,
        nextCursor: "next",
      },
      {
        items: [
          row({
            id: 2,
            rangeStart: 1_000_200,
            rangeEnd: 1_000_249,
            capacity: 50,
            abcRangeGapBefore: true,
          }),
        ],
        total: 2,
        hasMore: false,
        nextCursor: null,
      },
    ];
    const read = await readInnRanges({
      list: async () => pages.shift() ?? pages[0]!,
      summary: async () => summary(2, 150),
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.capacity).toBe(150);
    expect(read.ranges).toHaveLength(2);
  });

  it("does not publish when a row has another INN", async () => {
    const read = await readInnRanges({
      list: async () => ({
        items: [row({ id: 1, rangeStart: 1, rangeEnd: 1, capacity: 1, inn: "7700000000" })],
        total: 1,
        hasMore: false,
        nextCursor: null,
      }),
      summary: async () => summary(1, 1),
    });
    expect(read).toEqual({
      ok: false,
      error: "В ответе чужой ИНН. Каталог не изменён.",
    });
  });

  it("does not publish an empty slice when the recount disagrees", async () => {
    let calls = 0;
    const read = await readInnRanges({
      list: async () => {
        calls += 1;
        return { items: [], total: 0, hasMore: false, nextCursor: null };
      },
      summary: async () => summary(1, 10),
    });
    expect(read.ok).toBe(false);
    expect(calls).toBe(2);
  });

  it("publishes an empty slice only when the page and the summary are both empty", async () => {
    const read = await readInnRanges({
      list: async () => ({ items: [], total: 0, hasMore: false, nextCursor: null }),
      summary: async () => summary(0, 0),
    });
    expect(read).toEqual({ ok: true, ranges: [], capacity: 0 });
  });

  it("reads the list once more when the locked total moves", async () => {
    let shifted = false;
    const read = await readInnRanges({
      list: async (cursor) => {
        if (!shifted && cursor == null) {
          return {
            items: [row({ id: 1, rangeStart: 1, rangeEnd: 1, capacity: 1 })],
            total: 2,
            hasMore: true,
            nextCursor: "next",
          };
        }
        if (!shifted) {
          shifted = true;
          return {
            items: [row({ id: 2, rangeStart: 2, rangeEnd: 2, capacity: 1 })],
            total: 3,
            hasMore: false,
            nextCursor: null,
          };
        }
        return {
          items: [row({ id: 1, rangeStart: 1, rangeEnd: 1, capacity: 1 })],
          total: 1,
          hasMore: false,
          nextCursor: null,
        };
      },
      summary: async () => summary(1, 1),
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.capacity).toBe(1);
  });
});
