import { describe, expect, it } from "vitest";
import type { RunexisPage } from "@/modules/runexis/client";
import { runRunexisWalk, type WalkDeps } from "@/modules/runexis/walk";

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

function emptyBought(): RunexisPage {
  return okPage([], 0, 1);
}

function directory(rows: { city_id: number | null; codes: string[] }[]): RunexisPage {
  return {
    ok: true,
    data: { success: true, data: rows },
    meta: { status: 200, attempts: 1, durationMs: 1 },
  };
}

function harness(
  showcasePages: RunexisPage[],
  managementPages: RunexisPage[] = [emptyBought()],
  extra?: Partial<WalkDeps>,
  rows: { city_id: number | null; codes: string[] }[] = [
    { city_id: null, codes: ["901"] },
  ],
) {
  const free: string[][] = [];
  const purchased: string[][] = [];
  let published = 0;
  let dropped = 0;
  let showcaseCursor = 0;
  let managementCursor = 0;
  let codesCursor = 0;
  const deps: WalkDeps = {
    codes: async () => {
      codesCursor += 1;
      return directory(rows);
    },
    showcase: async () => {
      const page = showcasePages[showcaseCursor];
      showcaseCursor += 1;
      if (!page) throw new Error("Лишняя страница.");
      return page;
    },
    management: async () => {
      const page = managementPages[managementCursor];
      managementCursor += 1;
      if (!page) throw new Error("Лишняя страница.");
      return page;
    },
    stillMine: async () => "ok",
    stopping: () => false,
    stageFree: async (rowsToStage) => {
      free.push(rowsToStage.map((item) => item.e164));
      return rowsToStage.length;
    },
    stagePurchased: async (dids) => {
      purchased.push(dids);
    },
    prepare: async () => undefined,
    publish: async () => {
      published += 1;
      return { free: free.flat().length, purchased: purchased.flat().length };
    },
    dropStage: async () => {
      dropped += 1;
    },
    progress: async () => undefined,
    log: async () => undefined,
    flushLog: async () => undefined,
    ...extra,
  };
  return {
    deps,
    free,
    purchased,
    published: () => published,
    dropped: () => dropped,
    askedShowcase: () => showcaseCursor,
    askedManagement: () => managementCursor,
    askedCodes: () => codesCursor,
  };
}

describe("runexis walk", () => {
  it("does not publish when no free number was staged", async () => {
    const walk = harness(
      [okPage([], 0, 1)],
      [
        {
          ok: true,
          data: {
            success: true,
            data: [{ code: 495, number: "3084480", status: { mnemonic: "allocated" } }],
            meta: { total: 1, page: 1, limit: 30 },
          },
          meta: { status: 200, attempts: 1, durationMs: 1 },
        },
      ],
    );
    const result = await runRunexisWalk(walk.deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Свободных номеров нет");
    expect(walk.published()).toBe(0);
    expect(walk.dropped()).toBe(1);
    expect(walk.purchased.flat()).toEqual(["74953084480"]);
    expect(walk.askedManagement()).toBe(1);
    expect(walk.askedShowcase()).toBe(1);
  });

  it("publishes a short last page when the count matches", async () => {
    const walk = harness(
      [
        okPage(
          Array.from({ length: 30 }, (_, index) => row(index)),
          31,
          1,
        ),
        okPage([row(30)], 31, 2),
      ],
      [
        {
          ok: true,
          data: {
            success: true,
            data: [
              { code: 495, number: "3084480", status: { mnemonic: "allocated" } },
              { code: "901", number: "0000000", status: { mnemonic: "free" } },
            ],
            meta: { total: 2, page: 1, limit: 30 },
          },
          meta: { status: 200, attempts: 1, durationMs: 1 },
        },
      ],
    );
    const result = await runRunexisWalk(walk.deps);
    expect(result).toEqual({ ok: true, free: 31, purchased: 1 });
    expect(walk.free.flat()[0]).toBe("79010000000");
    expect(walk.purchased.flat()).toEqual(["74953084480"]);
    expect(walk.askedShowcase()).toBe(2);
  });

  it("leaves both catalogs when the showcase ends early", async () => {
    const walk = harness([okPage([row(1)], 40, 1)]);
    const result = await runRunexisWalk(walk.deps);
    expect(result.ok).toBe(false);
    expect(walk.published()).toBe(0);
    expect(walk.dropped()).toBe(1);
    expect(walk.askedManagement()).toBe(1);
    expect(walk.askedShowcase()).toBe(1);
  });

  it("leaves both catalogs when a status is missing", async () => {
    const walk = harness(
      [okPage([row(1)], 1, 1)],
      [
        {
          ok: true,
          data: {
            success: true,
            data: [{ code: "901", number: "0000001" }],
            meta: { total: 1, page: 1, limit: 30 },
          },
          meta: { status: 200, attempts: 1, durationMs: 1 },
        },
      ],
    );
    const result = await runRunexisWalk(walk.deps);
    expect(result.ok).toBe(false);
    expect(walk.published()).toBe(0);
    expect(walk.dropped()).toBe(1);
    expect(walk.askedShowcase()).toBe(0);
  });

  it("leaves both catalogs when the total changes", async () => {
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
    const result = await runRunexisWalk(walk.deps);
    expect(result.ok).toBe(false);
    expect(walk.published()).toBe(0);
    expect(walk.dropped()).toBe(1);
    expect(walk.askedManagement()).toBe(1);
  });

  it("does not publish after the stop flag", async () => {
    let stop = false;
    const walk = harness([okPage([row(1)], 1, 1)], [emptyBought()], {
      progress: async () => {
        stop = true;
      },
      stopping: () => stop,
    });
    const result = await runRunexisWalk(walk.deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("cancelled");
    expect(walk.published()).toBe(0);
    expect(walk.dropped()).toBe(1);
  });

  it("records a failed page and does not publish", async () => {
    const written: string[] = [];
    const walk = harness(
      [
        {
          ok: false,
          error: "Площадка не ответила. HTTP 0, попыток 2, 60012 мс.",
          meta: { status: 0, attempts: 2, durationMs: 60012 },
        },
      ],
      [emptyBought()],
      {
        log: async (block) => {
          written.push(block);
        },
      },
      [{ city_id: 58, codes: ["901"] }],
    );
    const result = await runRunexisWalk(walk.deps);
    expect(result.ok).toBe(false);
    expect(walk.published()).toBe(0);
    expect(walk.dropped()).toBe(1);
    const text = written.join("\n");
    expect(text).toContain("Витрина, код 901, страница 1");
    expect(text).not.toContain("город");
    expect(text).toContain("HTTP: 0");
    expect(text).toContain("Попыток: 2");
    expect(text).toContain("Длительность, мс: 60012");
    expect(text).not.toContain("://");
  });

  it("does not open the showcase when the code directory is rejected", async () => {
    let asked = 0;
    const walk = harness([okPage([row(1)], 1, 1)], [emptyBought()], {
      codes: async () => ({
        ok: true,
        data: { success: true, data: [{ city_id: null, codes: ["9"] }] },
        meta: { status: 200, attempts: 1, durationMs: 1 },
      }),
      showcase: async () => {
        asked += 1;
        return okPage([row(1)], 1, 1);
      },
    });
    const result = await runRunexisWalk(walk.deps);
    expect(result.ok).toBe(false);
    expect(walk.published()).toBe(0);
    expect(walk.dropped()).toBe(1);
    expect(asked).toBe(0);
    expect(walk.askedManagement()).toBe(1);
  });

  it("keeps one draft row when the same number is already staged", async () => {
    const accepted: number[] = [];
    const seen = new Set<string>();
    const walk = harness(
      [okPage([row(1)], 1, 1), okPage([row(1)], 1, 1)],
      [emptyBought()],
      {
        stageFree: async (rowsToStage) => {
          let inserted = 0;
          for (const item of rowsToStage) {
            if (seen.has(item.e164)) continue;
            seen.add(item.e164);
            inserted += 1;
          }
          return inserted;
        },
        progress: async (list, _page, _total, count) => {
          if (list === "showcase") accepted.push(count);
        },
      },
      [
        { city_id: 58, codes: ["901"] },
        { city_id: null, codes: ["901"] },
      ],
    );
    const result = await runRunexisWalk(walk.deps);
    expect(result.ok).toBe(true);
    expect(walk.askedShowcase()).toBe(2);
    expect(accepted.at(-1)).toBe(1);
  });

  it("does not publish when a showcase row belongs to another code", async () => {
    const walk = harness([okPage([["495", "3084480"]], 1, 1)]);
    const result = await runRunexisWalk(walk.deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("другого кода");
    expect(walk.published()).toBe(0);
    expect(walk.dropped()).toBe(1);
    expect(walk.free).toEqual([]);
    expect(walk.askedShowcase()).toBe(1);
  });

  it("rejects a repeated number on one page", async () => {
    const walk = harness([okPage([row(1), row(1)], 2, 1)]);
    const result = await runRunexisWalk(walk.deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("повторяется номер");
    expect(walk.published()).toBe(0);
    expect(walk.free).toEqual([]);
  });
});
