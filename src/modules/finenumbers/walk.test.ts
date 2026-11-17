import { describe, expect, it } from "vitest";

import { FINENUMBERS_INN } from "@/modules/finenumbers/expand";
import { readAllPages, readAllPagesTwice } from "@/modules/finenumbers/pages";
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

  it("keeps the locked total when a cursor page reports zero", async () => {
    const read = await readInnRanges({
      list: async (cursor) => {
        if (cursor == null) {
          return {
            items: [row({ id: 1, rangeStart: 1, rangeEnd: 1, capacity: 1 })],
            total: 2,
            hasMore: true,
            nextCursor: "next",
          };
        }
        return {
          items: [row({ id: 2, rangeStart: 2, rangeEnd: 2, capacity: 1 })],
          total: 0,
          hasMore: false,
          nextCursor: null,
        };
      },
      summary: async () => summary(2, 2),
    });
    expect(read).toEqual({
      ok: true,
      ranges: [
        {
          id: 1,
          abc: "495",
          rangeStart: 1,
          rangeEnd: 1,
          capacity: 1,
          operator: "Finenumbers",
          geography: "Москва",
        },
        {
          id: 2,
          abc: "495",
          rangeStart: 2,
          rangeEnd: 2,
          capacity: 1,
          operator: "Finenumbers",
          geography: "Москва",
        },
      ],
      capacity: 2,
    });
  });

  it("does not publish a short tail when the cursor page reports zero", async () => {
    const read = await readInnRanges({
      list: async (cursor) => {
        if (cursor == null) {
          return {
            items: [row({ id: 1, rangeStart: 1, rangeEnd: 1, capacity: 1 })],
            total: 2,
            hasMore: true,
            nextCursor: "next",
          };
        }
        return { items: [], total: 0, hasMore: false, nextCursor: null };
      },
      summary: async () => summary(1, 1),
    });
    expect(read).toEqual({
      ok: false,
      error: "Список диапазонов неполный. Каталог не изменён.",
    });
  });

  it("does not publish rows past the locked total when the cursor page reports zero", async () => {
    const read = await readInnRanges({
      list: async (cursor) => {
        if (cursor == null) {
          return {
            items: [row({ id: 1, rangeStart: 1, rangeEnd: 1, capacity: 1 })],
            total: 1,
            hasMore: true,
            nextCursor: "next",
          };
        }
        return {
          items: [row({ id: 2, rangeStart: 2, rangeEnd: 2, capacity: 1 })],
          total: 0,
          hasMore: false,
          nextCursor: null,
        };
      },
      summary: async () => summary(2, 2),
    });
    expect(read).toEqual({
      ok: false,
      error: "Список диапазонов неполный. Каталог не изменён.",
    });
  });

  it("does not treat a negative cursor total as an empty recount", async () => {
    let calls = 0;
    const read = await readInnRanges({
      list: async (cursor) => {
        calls += 1;
        if (cursor == null) {
          return {
            items: [row({ id: 1, rangeStart: 1, rangeEnd: 1, capacity: 1 })],
            total: 2,
            hasMore: true,
            nextCursor: "next",
          };
        }
        return {
          items: [row({ id: 2, rangeStart: 2, rangeEnd: 2, capacity: 1 })],
          total: -1,
          hasMore: true,
          nextCursor: "more",
        };
      },
      summary: async () => summary(2, 2),
    });
    expect(calls).toBe(2);
    expect(read).toEqual({
      ok: false,
      error: "Список диапазонов неполный. Каталог не изменён.",
    });
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

describe("range page stop", () => {
  function page(total: number) {
    return async (cursor: string | null) => {
      const id = cursor == null ? 1 : Number(cursor) + 1;
      return {
        items: [{ id }],
        total,
        hasMore: id < total,
        nextCursor: id < total ? String(id) : null,
      };
    };
  }

  it("reads every page when nothing asks it to stop", async () => {
    let calls = 0;
    const read = await readAllPages({
      page: async (cursor) => {
        calls += 1;
        return page(2)(cursor);
      },
      accept: () => ({ kind: "keep" }),
    });
    expect(calls).toBe(2);
    expect(read.ok).toBe(true);
  });

  it("stops before the next page and does not read the list again", async () => {
    let calls = 0;
    const read = await readAllPagesTwice({
      page: async (cursor) => {
        calls += 1;
        return page(2)(cursor);
      },
      accept: () => ({ kind: "keep" }),
      stop: async () => calls > 0,
    });
    expect(calls).toBe(1);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.stopped).toBe(true);
    expect(read.again).toBe(false);
    expect(read.error).toBe("");
  });
});
