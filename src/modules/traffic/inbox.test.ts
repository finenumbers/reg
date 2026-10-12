import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  inboxFileError,
  isInboxDataFile,
  openPoisonedInboxFile,
} from "@/modules/traffic/inbox";
import { CDR_MAX_FILE_BYTES } from "@/modules/traffic/columns";
import { POISON_FILENAME } from "@/modules/traffic/paths";
import { markPoisoned } from "@/modules/traffic/poison";

describe("inbox helpers", () => {
  it("skips dotfiles, poison store, and non-dump names", () => {
    expect(isInboxDataFile(".hidden")).toBe(false);
    expect(isInboxDataFile(POISON_FILENAME)).toBe(false);
    expect(isInboxDataFile("Test")).toBe(false);
    expect(isInboxDataFile("test.txt")).toBe(false);
    expect(isInboxDataFile("20260827_200419.csv")).toBe(false);
    expect(isInboxDataFile("20260827_200419")).toBe(true);
  });

  it("rejects empty and oversized files", () => {
    expect(
      inboxFileError({
        filename: "a",
        absPath: "/a",
        size: 0,
        mtimeMs: 1,
      }),
    ).toMatch(/пустой/);
    expect(
      inboxFileError({
        filename: "b",
        absPath: "/b",
        size: CDR_MAX_FILE_BYTES + 1,
        mtimeMs: 1,
      }),
    ).toMatch(/большой/);
    expect(
      inboxFileError({
        filename: "c",
        absPath: "/c",
        size: 10,
        mtimeMs: 1,
      }),
    ).toBeNull();
  });
});

describe("openPoisonedInboxFile", () => {
  let inboxDir = "";
  const prevInbox = process.env.CDR_INBOX_DIR;
  const filename = "20261012_063807";

  beforeEach(async () => {
    inboxDir = await mkdtemp(path.join(tmpdir(), "cdr-inbox-"));
    process.env.CDR_INBOX_DIR = inboxDir;
  });

  afterEach(async () => {
    if (prevInbox === undefined) delete process.env.CDR_INBOX_DIR;
    else process.env.CDR_INBOX_DIR = prevInbox;
    if (inboxDir) await rm(inboxDir, { recursive: true, force: true });
    inboxDir = "";
  });

  it("rejects a name that is not a dump, even if the journal mentions it", async () => {
    markPoisoned("../secret", 1, "bad");
    expect(await openPoisonedInboxFile("../secret")).toBeNull();
    expect(await openPoisonedInboxFile(POISON_FILENAME)).toBeNull();
  });

  it("rejects a dump that is not in the journal", async () => {
    await writeFile(path.join(inboxDir, filename), "cdr\n", "utf8");
    expect(await openPoisonedInboxFile(filename)).toBeNull();
  });

  it("returns null when the journal names a file that is gone", async () => {
    markPoisoned(filename, 1, "Частичная загрузка");
    expect(await openPoisonedInboxFile(filename)).toBeNull();
  });

  it("returns the current bytes when mtime no longer matches the journal", async () => {
    const body = "header\nrow\n";
    await writeFile(path.join(inboxDir, filename), body, "utf8");
    markPoisoned(filename, 1, "Частичная загрузка");

    const opened = await openPoisonedInboxFile(filename);
    expect(opened?.filename).toBe(filename);
    expect(opened?.size).toBe(Buffer.byteLength(body));
    expect(opened?.absPath).toBe(await realpath(path.join(inboxDir, filename)));
  });

  it("refuses a symlink that leaves the inbox", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "cdr-outside-"));
    try {
      await writeFile(path.join(outside, "secret"), "secret", "utf8");
      await symlink(path.join(outside, "secret"), path.join(inboxDir, filename));
      markPoisoned(filename, 1, "Частичная загрузка");
      expect(await openPoisonedInboxFile(filename)).toBeNull();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
