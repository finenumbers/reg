import { describe, expect, it } from "vitest";
import { drainCursorPages, drainOffsetPages } from "@/modules/table-export/pages";

describe("catalog page walks", () => {
  it("follows a cursor after a page that would have reported total -1", async () => {
    const seen: number[] = [];
    let calls = 0;
    await drainCursorPages({
      retryDelayMs: () => null,
      load: async (cursor) => {
        calls += 1;
        if (cursor == null) return { items: [1], hasMore: true, nextCursor: "a" };
        if (cursor === "a") return { items: [2], hasMore: true, nextCursor: "b" };
        return { items: [3], hasMore: false, nextCursor: null };
      },
      onPage: (items) => {
        seen.push(...items);
      },
    });
    expect(calls).toBe(3);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("stops when the next cursor repeats", async () => {
    const seen: string[] = [];
    await drainCursorPages({
      retryDelayMs: () => null,
      load: async () => ({ items: ["row"], hasMore: true, nextCursor: "same" }),
      onPage: (items) => {
        seen.push(...items);
      },
    });
    expect(seen).toEqual(["row", "row"]);
  });

  it("does not stop an offset walk on total -1", async () => {
    let calls = 0;
    await drainOffsetPages({
      pageSize: 2,
      retryDelayMs: () => null,
      load: async (page) => {
        calls += 1;
        if (page < 3) return { items: [page, page], total: -1 };
        return { items: [page], total: -1 };
      },
      onPage: () => {},
    });
    expect(calls).toBe(3);
  });

  it("keeps walking a 200-row page when that size was accepted and 400 remain", async () => {
    const seen: number[] = [];
    await drainOffsetPages({
      pageSize: 500,
      retryDelayMs: () => null,
      load: async (page) => {
        seen.push(page);
        if (page === 1) {
          return { items: Array.from({ length: 200 }, (_, i) => i), total: 400, pageSize: 200 };
        }
        return {
          items: Array.from({ length: 200 }, (_, i) => i + 200),
          total: 400,
          pageSize: 200,
        };
      },
      onPage: () => {},
    });
    expect(seen).toEqual([1, 2]);
  });

  it("stops a 200-row page when the walk still expects 500", async () => {
    const seen: number[] = [];
    await drainOffsetPages({
      pageSize: 500,
      retryDelayMs: () => null,
      load: async (page) => {
        seen.push(page);
        return { items: Array.from({ length: 200 }, (_, i) => i), total: 400 };
      },
      onPage: () => {},
    });
    expect(seen).toEqual([1]);
  });

  it("stops an offset walk once the reported total is covered", async () => {
    const pages: number[] = [];
    await drainOffsetPages({
      pageSize: 2,
      retryDelayMs: () => null,
      load: async (page) => {
        pages.push(page);
        return { items: [page, page], total: 4 };
      },
      onPage: () => {},
    });
    expect(pages).toEqual([1, 2]);
  });
});
