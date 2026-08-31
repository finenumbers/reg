import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearPurgeHolds,
  listPoisonEntries,
  markPoisoned,
  purgeHoldMessage,
} from "@/modules/traffic/poison";

describe("poison journal", () => {
  let inboxDir = "";
  const prevInbox = process.env.CDR_INBOX_DIR;

  beforeEach(async () => {
    inboxDir = await mkdtemp(path.join(tmpdir(), "cdr-poison-"));
    process.env.CDR_INBOX_DIR = inboxDir;
  });

  afterEach(async () => {
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
});
