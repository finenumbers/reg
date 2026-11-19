import { describe, expect, it } from "vitest";
import type { UisPage } from "@/modules/uis/client";
import { decidePublish, dropOverlapSql, stageFreeSql } from "@/modules/uis/sql";
import { PAGE_LIMIT, WINDOW, type UisFilter, type UisList } from "@/modules/uis/url";
import { runUisPurchasedWalk, type WalkDeps } from "@/modules/uis/walk";

function ok(total: number, length: number | null): UisPage {
  return {
    ok: true,
    total,
    rows:
      length == null
        ? null
        : Array.from({ length }, () => ({
            e164: "74951234567",
            incomingPurchase: "",
            incomingPeriod: "",
          })),
    meta: { status: 200, attempts: 1, durationMs: 1 },
  };
}

function deps(over: Partial<WalkDeps> = {}): WalkDeps {
  return {
    count: async () => ok(0, null),
    page: async () => ok(0, 0),
    stillMine: async () => "ok",
    stopping: () => false,
    stageFree: async () => undefined,
    stagePurchased: async () => undefined,
    prepare: async () => undefined,
    publish: async () => ({ inserted: 0 }),
    dropStage: async () => undefined,
    progress: async () => undefined,
    log: async () => undefined,
    flushLog: async () => undefined,
    ...over,
  };
}

describe("UIS walk", () => {
  it("publishes a complete empty list and does not read free numbers after a purchased failure", async () => {
    let free = false;
    const empty = deps({
      count: async (list) => {
        if (list === "free") free = true;
        return ok(0, null);
      },
    });
    const result = await runUisPurchasedWalk(empty);
    expect(result).toEqual({ ok: true, inserted: 0 });
    expect(free).toBe(false);

    const lists: UisList[] = [];
    const failed = deps({
      count: async (list) => {
        lists.push(list);
        return {
          ok: false,
          error: "Площадка отклонила запрос.",
          meta: { status: 200, attempts: 1, durationMs: 1 },
        };
      },
    });
    let published = false;
    const stopped = await runUisPurchasedWalk({
      ...failed,
      publish: async () => {
        published = true;
        return { inserted: 0 };
      },
    });
    expect(stopped.ok).toBe(false);
    expect(lists).toEqual(["purchased"]);
    expect(published).toBe(false);
  });

  it("reads a list past 110000 without an offset past 100000", async () => {
    const offsets: number[] = [];
    const filters = new Set<string>();
    const root = WINDOW + 10_000;
    const result = await runUisPurchasedWalk(
      deps({
        count: async (_list, filter) => {
          filters.add(filter.kind === "all" ? "all" : filter.kind);
          if (filter.kind === "all") return ok(root, null);
          if (filter.kind === "like") return ok(12_000, null);
          return ok(0, null);
        },
        page: async (_list, _filter, offset) => {
          offsets.push(offset);
          const got = offset === 0 ? PAGE_LIMIT : 2_000;
          return ok(12_000, got);
        },
      }),
    );
    expect(result.ok).toBe(true);
    expect(filters.has("like")).toBe(true);
    expect(Math.max(...offsets)).toBeLessThanOrEqual(100_000);
    expect(offsets).not.toContain(110_000);
  });

  it("uses offset 100000 for a window that still fits in one slice", async () => {
    const offsets: number[] = [];
    await runUisPurchasedWalk(
      deps({
        count: async (_list, filter: UisFilter) => {
          expect(filter.kind).toBe("all");
          return ok(WINDOW, null);
        },
        page: async (_list, _filter, offset) => {
          offsets.push(offset);
          return ok(WINDOW, PAGE_LIMIT);
        },
      }),
    );
    expect(offsets).toContain(100_000);
    expect(
      offsets.every((offset) => offset <= 100_000 && offset % PAGE_LIMIT === 0),
    ).toBe(true);
  });

  it("drops a free number that is already purchased and commits an empty replace", () => {
    const text = dropOverlapSql("run-1").strings.join(" ");
    expect(text).toContain("catalog = 'free'");
    expect(text).toContain("catalog = 'purchased'");
    expect(
      decidePublish({
        held: true,
        stagedFree: 0,
        insertedFree: 0,
        stagedPurchased: 0,
        insertedPurchased: 0,
      }),
    ).toBe("commit");
    const staged = stageFreeSql("run-1", [
      { e164: "74951234567", incomingPurchase: "1.5", incomingPeriod: "" },
    ]);
    expect(staged.strings.join(" ")).not.toContain("ON CONFLICT");
    expect(staged.strings.join(" ")).toContain("'free'");
  });
});
