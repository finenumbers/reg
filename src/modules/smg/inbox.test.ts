import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openPoisonedSmgFile } from "@/modules/smg/inbox";
import { markSmgPoisoned } from "@/modules/smg/poison";

describe("openPoisonedSmgFile", () => {
  let inbox: string;
  const previous = process.env.SMG_CDR_INBOX_DIR;

  beforeEach(async () => {
    inbox = await mkdtemp(path.join(tmpdir(), "smg-download-"));
    process.env.SMG_CDR_INBOX_DIR = inbox;
  });

  afterEach(async () => {
    if (previous == null) delete process.env.SMG_CDR_INBOX_DIR;
    else process.env.SMG_CDR_INBOX_DIR = previous;
    await rm(inbox, { recursive: true, force: true });
  });

  it("serves a journaled file and refuses a path that leaves the inbox", async () => {
    const name = "20261013.cdr";
    await writeFile(path.join(inbox, name), "cdr", "utf8");
    markSmgPoisoned(name, 1, "ошибка");
    const opened = await openPoisonedSmgFile(name);
    expect(opened?.filename).toBe(name);

    markSmgPoisoned("../secret.cdr", 1, "ошибка");
    expect(await openPoisonedSmgFile("../secret.cdr")).toBeNull();
    expect(await openPoisonedSmgFile(".poison.json")).toBeNull();
  });

  it("refuses a symlink that points outside the inbox", async () => {
    const outside = path.join(path.dirname(inbox), "outside.cdr");
    await writeFile(outside, "secret", "utf8");
    await symlink(outside, path.join(inbox, "20261013120000.cdr"));
    markSmgPoisoned("20261013120000.cdr", 1, "ошибка");
    expect(await openPoisonedSmgFile("20261013120000.cdr")).toBeNull();
    await rm(outside, { force: true });
  });
});
