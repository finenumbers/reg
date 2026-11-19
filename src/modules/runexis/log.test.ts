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
      await beginRunexisLog("run-1", "free");
      await appendRunexisLog("Витрина, код 901, страница 1\nHTTP: 200\n");
      const held = await readFile(path.join(dir, "runexis-free.txt"), "utf8");
      expect(held).toContain("Список: Свободные");
      expect(held).toContain("Идентификатор: run-1");
      expect(held).not.toContain("страница 1");
      await flushRunexisLog();
      const flushed = await readFile(path.join(dir, "runexis-free.txt"), "utf8");
      expect(flushed).toContain("Витрина, код 901, страница 1");
      expect(flushed).toContain("HTTP: 200");
      expect(flushed).not.toContain("://");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the pending buffer on the side that began", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "runexis-log-"));
    setRunexisLogDirForTests(dir);
    try {
      await beginRunexisLog("run-p", "purchased");
      await appendRunexisLog("Купленные, страница 1\n");
      await beginRunexisLog("run-f", "free");
      await appendRunexisLog("Витрина, код 901, страница 1\n");
      await flushRunexisLog();
      const purchased = await readFile(path.join(dir, "runexis-purchased.txt"), "utf8");
      const free = await readFile(path.join(dir, "runexis-free.txt"), "utf8");
      expect(purchased).toContain("Список: Купленные");
      expect(purchased).toContain("Идентификатор: run-p");
      expect(purchased).not.toContain("страница 1");
      expect(free).toContain("Витрина, код 901, страница 1");
      expect(free).not.toContain("run-p");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
