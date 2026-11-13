import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendSipoutLog,
  beginSipoutLog,
  setNumberingSyncLogDirForTests,
} from "@/modules/numbering-sync/log";

const KEY = "super-secret-key";

afterEach(() => {
  setNumberingSyncLogDirForTests(null);
});

describe("sipout stage log", () => {
  it("replaces the previous run and keeps the key and the URL out", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sipout-log-"));
    setNumberingSyncLogDirForTests(dir);
    await beginSipoutLog("run-1");
    await appendSipoutLog(`Ошибка: key=${KEY} https://lk.sipout.net/userapi/?key=${KEY}\n`);
    await beginSipoutLog("run-2");
    await appendSipoutLog("Городов: 1\n");
    const text = await readFile(path.join(dir, "sipout.txt"), "utf8");
    expect(text).toContain("Идентификатор: run-2");
    expect(text).toContain("Городов: 1");
    expect(text).not.toContain("run-1");
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("key=");
    expect(text).not.toContain("://");
  });
});
