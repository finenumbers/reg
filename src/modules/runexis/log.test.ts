import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendRunexisLog,
  beginRunexisLog,
  flushRunexisLog,
  setRunexisLogDirForTests,
} from "@/modules/runexis/log";

afterEach(() => {
  setRunexisLogDirForTests(null);
});

describe("runexis stage log", () => {
  it("keeps a page in memory until the code is flushed", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "runexis-log-"));
    setRunexisLogDirForTests(dir);
    try {
      await beginRunexisLog("run-1");
      await appendRunexisLog("Витрина, код 901, страница 1\nHTTP: 200\n");
      const held = await readFile(path.join(dir, "runexis.txt"), "utf8");
      expect(held).toContain("Идентификатор: run-1");
      expect(held).not.toContain("страница 1");
      await flushRunexisLog();
      const flushed = await readFile(path.join(dir, "runexis.txt"), "utf8");
      expect(flushed).toContain("Витрина, код 901, страница 1");
      expect(flushed).toContain("HTTP: 200");
      expect(flushed).not.toContain("://");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
