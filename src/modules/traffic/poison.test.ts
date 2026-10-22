import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearAllPurgeHolds,
  clearPoisonExceptMonthHold,
  clearPurgeHolds,
  clearPurgeHoldsExcept,
  errorHoldsMonth,
  isPoisoned,
  listPoisonEntries,
  markPoisoned,
  purgeHoldMessage,
} from "@/modules/traffic/poison";
import {
  resetPurgeTargetForTests,
  setPurgeTargetMonth,
} from "@/modules/traffic/purge/target";

describe("poison journal", () => {
  let inboxDir = "";
  const prevInbox = process.env.CDR_INBOX_DIR;

  beforeEach(async () => {
    inboxDir = await mkdtemp(path.join(tmpdir(), "cdr-poison-"));
    process.env.CDR_INBOX_DIR = inboxDir;
  });

  afterEach(async () => {
    resetPurgeTargetForTests();
    if (prevInbox === undefined) delete process.env.CDR_INBOX_DIR;
    else process.env.CDR_INBOX_DIR = prevInbox;
    if (inboxDir) await rm(inboxDir, { recursive: true, force: true });
    inboxDir = "";
  });

  it("lists all entries and clears only purge holds for the target month", () => {
    markPoisoned("bad.csv", 1, "Нет даты");
    markPoisoned("july.csv", 2, purgeHoldMessage("2026-07"));
    markPoisoned("aug.csv", 3, purgeHoldMessage("2026-08"));

    expect(listPoisonEntries()).toEqual([
      { filename: "aug.csv", error: purgeHoldMessage("2026-08"), heldForPurge: true },
      { filename: "bad.csv", error: "Нет даты", heldForPurge: false },
      { filename: "july.csv", error: purgeHoldMessage("2026-07"), heldForPurge: true },
    ]);

    expect(clearPurgeHolds("2026-07")).toBe(1);
    expect(listPoisonEntries().map((item) => item.filename)).toEqual([
      "aug.csv",
      "bad.csv",
    ]);
  });

  it("keeps only the live purge hold on retry and drops every hold on startup", () => {
    markPoisoned("bad.csv", 1, "Нет даты");
    markPoisoned("july.csv", 2, purgeHoldMessage("2026-07"));
    markPoisoned(
      "july-part.csv",
      4,
      `${purgeHoldMessage("2026-07")}. Вставлено 1 записей других месяцев в july-part.csv.`,
    );
    markPoisoned("aug.csv", 3, purgeHoldMessage("2026-08"));

    clearPoisonExceptMonthHold("2026-07");
    expect(listPoisonEntries().map((item) => item.filename)).toEqual([
      "july-part.csv",
      "july.csv",
    ]);

    expect(clearAllPurgeHolds()).toBe(2);
    expect(listPoisonEntries()).toEqual([]);
  });

  it("keeps the interrupted month and drops other purge holds", () => {
    markPoisoned("bad.csv", 1, "Нет даты");
    markPoisoned("july.csv", 2, purgeHoldMessage("2026-07"));
    markPoisoned("aug.csv", 3, purgeHoldMessage("2026-08"));

    expect(clearPurgeHoldsExcept("2026-08")).toBe(1);
    expect(listPoisonEntries().map((item) => item.filename)).toEqual([
      "aug.csv",
      "bad.csv",
    ]);
    expect(clearPurgeHoldsExcept(null)).toBe(1);
    expect(listPoisonEntries().map((item) => item.filename)).toEqual(["bad.csv"]);
  });

  it("releases an empty-file hold when the dump later has bytes", () => {
    markPoisoned("20261014_035348", 10, "Файл пустой: 20261014_035348");
    expect(isPoisoned("20261014_035348", 10, undefined, 0)).toBe(true);
    expect(isPoisoned("20261014_035348", 10, undefined, 4096)).toBe(false);
  });

  it("keeps a hold when the size has not changed", () => {
    markPoisoned("bad.csv", 10, "Нет даты", undefined, 80);
    expect(isPoisoned("bad.csv", 10, undefined, 80)).toBe(true);
    expect(isPoisoned("bad.csv", 10, undefined, 120)).toBe(false);
  });

  it("clears a hold embedded in a partial-load error and leaves another month", () => {
    const july = `Частичная загрузка: вставлено 1 записей. (Отложено: идёт удаление 2026-07).`;
    const august = `Нет валидных строк; 3 отложено (Отложено: идёт удаление 2026-08)`;
    markPoisoned("july-part.csv", 4, july, undefined, 40);
    markPoisoned("aug-part.csv", 5, august, undefined, 50);
    markPoisoned("bad.csv", 1, "Нет даты", undefined, 10);

    expect(errorHoldsMonth(july, "2026-07")).toBe(true);
    expect(errorHoldsMonth(july, "2026-7")).toBe(false);
    expect(errorHoldsMonth("Отложено: идёт удаление 2026-10", "2026-1")).toBe(false);

    expect(clearPurgeHolds("2026-07")).toBe(1);
    expect(listPoisonEntries().map((item) => item.filename)).toEqual([
      "aug-part.csv",
      "bad.csv",
    ]);
    expect(clearAllPurgeHolds()).toBe(0);
  });

  it("hides a held file only while that month is still being deleted", () => {
    const error = `Частичная загрузка. (Отложено: идёт удаление 2026-07).`;
    markPoisoned("july-part.csv", 4, error, undefined, 40);
    expect(isPoisoned("july-part.csv", 4, undefined, 40)).toBe(false);
    setPurgeTargetMonth("2026-07");
    expect(isPoisoned("july-part.csv", 4, undefined, 40)).toBe(true);
    setPurgeTargetMonth("2026-08");
    expect(isPoisoned("july-part.csv", 4, undefined, 40)).toBe(false);
  });
});
