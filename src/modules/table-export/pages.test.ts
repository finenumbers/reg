import { describe, expect, it } from "vitest";
import { drainCursorPages } from "@/modules/table-export/pages";

describe("PSTN cursor page walks", () => {
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
});
