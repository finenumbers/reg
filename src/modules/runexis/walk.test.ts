import { describe, expect, it } from "vitest";
import type { RunexisPage } from "@/modules/runexis/client";
import { runFreeWalk, type FreeWalkDeps } from "@/modules/runexis/walk";

function row(index: number): [string, string] {
  return ["901", String(index).padStart(7, "0")];
}

function okPage(numbers: [string, string][], total: number, page: number): RunexisPage {
  return {
    ok: true,
    data: {
      success: true,
      data: numbers.map(([code, number]) => ({ code, number })),
      meta: { total, page, limit: 30 },
    },
    meta: { status: 200, attempts: 1, durationMs: 1 },
  };
}

function harness(pages: RunexisPage[], extra?: Partial<FreeWalkDeps>) {
  const staged: string[][] = [];
  let published = 0;
  let dropped = 0;
  let cursor = 0;
  const deps: FreeWalkDeps = {
    showcase: async () => {
      const page = pages[cursor];
      cursor += 1;
      if (!page) throw new Error("Лишняя страница.");
      return page;
    },
    stillMine: async () => "ok",
    stopping: () => false,
    stage: async (dids) => {
      staged.push(dids);
    },
    prepare: async () => undefined,
    publish: async () => {
      published += 1;
      return { inserted: staged.flat().length };
    },
    dropStage: async () => {
      dropped += 1;
    },
    progress: async () => undefined,
    log: async () => undefined,
    ...extra,
  };
  return {
    deps,
    staged,
    published: () => published,
    dropped: () => dropped,
    asked: () => cursor,
  };
}

describe("runexis free walk", () => {
  it("publishes a complete empty showcase", async () => {
    const walk = harness([okPage([], 0, 1)]);
    const result = await runFreeWalk(walk.deps);
    expect(result).toEqual({ ok: true, inserted: 0 });
    expect(walk.published()).toBe(1);
    expect(walk.dropped()).toBe(0);
    expect(walk.staged).toEqual([]);
  });

  it("publishes a short last page when the count matches", async () => {
    const walk = harness([
      okPage(
        Array.from({ length: 30 }, (_, index) => row(index)),
        31,
        1,
      ),
      okPage([row(30)], 31, 2),
    ]);
    const result = await runFreeWalk(walk.deps);
    expect(result.ok).toBe(true);
    expect(walk.published()).toBe(1);
    expect(walk.staged.flat()).toHaveLength(31);
    expect(walk.asked()).toBe(2);
  });

  it("leaves the catalog when a page ends early", async () => {
    const walk = harness([okPage([row(1)], 40, 1)]);
    const result = await runFreeWalk(walk.deps);
    expect(result.ok).toBe(false);
    expect(walk.published()).toBe(0);
    expect(walk.dropped()).toBe(1);
    expect(walk.asked()).toBe(1);
  });

  it("leaves the catalog when the total changes", async () => {
    const walk = harness([
      okPage(
        Array.from({ length: 30 }, (_, index) => row(index)),
        60,
        1,
      ),
      okPage(
        Array.from({ length: 30 }, (_, index) => row(100 + index)),
        61,
        2,
      ),
    ]);
    const result = await runFreeWalk(walk.deps);
    expect(result.ok).toBe(false);
    expect(walk.published()).toBe(0);
    expect(walk.dropped()).toBe(1);
  });

  it("leaves the catalog when a code is not text", async () => {
    const walk = harness([
      {
        ok: true,
        data: {
          success: true,
          data: [{ code: 901, number: "1234567" }],
          meta: { total: 1, page: 1, limit: 30 },
        },
        meta: { status: 200, attempts: 1, durationMs: 1 },
      },
    ]);
    const result = await runFreeWalk(walk.deps);
    expect(result.ok).toBe(false);
    expect(walk.published()).toBe(0);
  });

  it("does not publish after the stop flag", async () => {
    let stop = false;
    const walk = harness([okPage([row(1)], 1, 1)], {
      progress: async () => {
        stop = true;
      },
      stopping: () => stop,
    });
    const result = await runFreeWalk(walk.deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("cancelled");
    expect(walk.published()).toBe(0);
    expect(walk.dropped()).toBe(1);
  });
});
