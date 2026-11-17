import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  droppedCopies,
  formatCount,
  formatSyncStamp,
  nextChainLabel,
  parsedShown,
  safeDropped,
  shownNumbers,
  type ParsedSnapshot,
} from "@/modules/numbering-sync/card-numbers";

const root = process.cwd();

function read(relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
}

function functionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = source.slice(start + signature.length);
  const next = rest.search(/\n(?:export )?(?:async )?function /);
  return next < 0 ? source.slice(start) : source.slice(start, start + signature.length + next);
}

function snapshot(patch: Partial<ParsedSnapshot> = {}): ParsedSnapshot {
  const providers = {
    sipout: { epoch: 1, done: 1, parsed: 0 },
    runexis: { epoch: 1, done: 1, parsed: 0 },
    uis: { epoch: 1, done: 1, parsed: 0 },
    aurora: { epoch: 1, done: 1, parsed: 0 },
    exolve: { epoch: 1, done: 1, parsed: 0 },
    voximplant: { epoch: 1, done: 1, parsed: 0 },
    mcn: { epoch: 1, done: 1, parsed: 0 },
    finenumbers: { epoch: 1, done: 1, parsed: 0 },
  };
  return {
    maskEpoch: 1,
    maskDone: 1,
    providers,
    ...patch,
    ...(patch.providers ? { providers: { ...providers, ...patch.providers } } : {}),
  };
}

describe("sync card numbers", () => {
  it("formats the stamp in the operator zone", () => {
    expect(formatSyncStamp(new Date("2026-12-26T19:00:00.000Z"), "Europe/Moscow")).toBe(
      "22:00, 26.12.2026",
    );
    expect(formatSyncStamp(null, "Europe/Moscow")).toBe("—");
    expect(nextChainLabel(new Date("2026-12-26T10:00:00.000Z"), "Europe/Moscow")).toBe(
      "01:00, 27.12.2026",
    );
  });

  it("keeps the previous number until that side has a staged row", () => {
    const previous = {
      busy: true,
      list: "",
      phase: "running",
      lastFree: 10,
      lastPurchased: 20,
      stagedFree: 0,
      stagedPurchased: 0,
    };
    expect(shownNumbers({ ...previous, kind: "sipout", step: "purchased" })).toEqual({
      purchasedShown: 20,
      freeShown: 10,
    });
    expect(
      shownNumbers({
        ...previous,
        kind: "sipout",
        step: "purchased",
        stagedPurchased: 4,
      }),
    ).toEqual({ purchasedShown: 4, freeShown: 10 });
    expect(
      shownNumbers({
        ...previous,
        kind: "sipout",
        step: "free",
        stagedPurchased: 0,
        stagedFree: 0,
      }),
    ).toEqual({ purchasedShown: 0, freeShown: 10 });
    expect(shownNumbers({ ...previous, kind: "sipout", step: "cities" })).toEqual({
      purchasedShown: 20,
      freeShown: 10,
    });
    expect(
      shownNumbers({
        ...previous,
        kind: "sipout",
        step: "free",
        busy: false,
        stagedFree: 9,
        stagedPurchased: 9,
      }),
    ).toEqual({ purchasedShown: 20, freeShown: 10 });
    expect(
      shownNumbers({
        ...previous,
        kind: "list",
        step: null,
        list: "free",
        stagedPurchased: 0,
        stagedFree: 3,
      }),
    ).toEqual({ purchasedShown: 0, freeShown: 3 });
    expect(shownNumbers({ ...previous, kind: "list", step: null, list: "" })).toEqual({
      purchasedShown: 20,
      freeShown: 10,
    });
    expect(
      shownNumbers({
        ...previous,
        kind: "sipout",
        step: "publishing",
        phase: "publishing",
        stagedFree: 0,
        stagedPurchased: 0,
      }),
    ).toEqual({ purchasedShown: 0, freeShown: 0 });
  });

  it("keeps Aurora on the previous free total until the draft is inserted", () => {
    expect(
      shownNumbers({
        kind: "aurora",
        busy: true,
        step: null,
        list: "free",
        phase: "running",
        lastFree: 8,
        lastPurchased: null,
        stagedFree: 0,
        stagedPurchased: 0,
      }).freeShown,
    ).toBe(8);
    expect(
      shownNumbers({
        kind: "aurora",
        busy: true,
        step: null,
        list: "free",
        phase: "running",
        lastFree: 8,
        lastPurchased: null,
        stagedFree: 5,
        stagedPurchased: 0,
      }).freeShown,
    ).toBe(5);
  });

  it("shows parsed counters while a mask or provider pass is open", () => {
    const openMask = snapshot({ maskEpoch: 2, maskDone: 1 });
    openMask.providers.sipout.parsed = 4;
    expect(parsedShown(openMask, "sipout", 100, 50)).toBe(4);
    const openProvider = snapshot();
    openProvider.providers.mcn = { epoch: 3, done: 2, parsed: 0 };
    expect(parsedShown(openProvider, "mcn", 100, 50)).toBe(0);
    expect(parsedShown(snapshot(), "sipout", 3, 4)).toBe(7);
    expect(parsedShown(snapshot(), "sipout", null, null)).toBeNull();
    expect(parsedShown(snapshot(), "aurora", 3, 9)).toBe(3);
    expect(parsedShown(snapshot(), "aurora", null, 9)).toBeNull();
  });

  it("counts copies that were not stored", () => {
    expect(droppedCopies(5, 3, 2)).toBe(3);
    expect(droppedCopies(3, 3, 3)).toBe(0);
    expect(safeDropped(-1)).toBe(0);
    expect(safeDropped(1.5)).toBe(0);
    expect(safeDropped(4)).toBe(4);
    expect(formatCount(null)).toBe("—");
    expect(formatCount(37652).replace(/\s/g, " ")).toBe("37 652");
  });

  it("writes the load time and the dropped count only in a successful publish", () => {
    const services = [
      "src/modules/numbering-sync/service.ts",
      "src/modules/runexis/service.ts",
      "src/modules/uis/service.ts",
      "src/modules/aurora/service.ts",
      "src/modules/exolve/service.ts",
      "src/modules/voximplant/service.ts",
      "src/modules/mcn/service.ts",
    ];
    const publishes = [
      "src/modules/numbering-sync/publish.ts",
      "src/modules/runexis/publish.ts",
      "src/modules/uis/publish.ts",
      "src/modules/aurora/publish.ts",
      "src/modules/exolve/publish.ts",
      "src/modules/voximplant/publish.ts",
      "src/modules/mcn/publish.ts",
    ];
    for (const file of services) {
      const body = functionBody(read(file), "async function finishError");
      expect(body).toContain("last_finished_at");
      expect(body).not.toContain("loaded_at");
      expect(body).not.toContain("duplicates_dropped");
    }
    for (const file of publishes) {
      const source = read(file);
      expect(source).toContain("loaded_at = CURRENT_TIMESTAMP");
      expect(source).toContain("duplicates_dropped = $4");
    }
    const runexis = read("src/modules/runexis/walk.ts");
    expect(runexis).toContain("chunk.length - inserted");
    const note = runexis.slice(runexis.indexOf("Пропущено free"));
    expect(note).not.toContain("addDuplicates");
    const qualified = [
      ["src/modules/numbering-sync/service.ts", "numbering_sync_state.run_id"],
      ["src/modules/runexis/service.ts", "runexis_sync_state.run_id"],
      ["src/modules/uis/service.ts", "uis_sync_state.run_id"],
      ["src/modules/aurora/service.ts", "aurora_sync_state.run_id"],
      ["src/modules/exolve/service.ts", "exolve_sync_state.run_id"],
      ["src/modules/voximplant/service.ts", "voximplant_sync_state.run_id"],
      ["src/modules/mcn/service.ts", "mcn_sync_state.run_id"],
    ] as const;
    for (const [file, column] of qualified) {
      const source = read(file);
      expect(source).toContain(`stage.run_id = ${column}`);
      expect(source).not.toContain("stage.run_id = run_id");
    }
  });
});
