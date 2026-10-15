import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  invalidateSyslogStoredBytes,
  readSyslogStoredBytes,
  sumSyslogStoredBytes,
  SYSLOG_STORED_BYTES_TTL_MS,
} from "@/modules/smg-syslog/browse";
import { purgeSyslogBefore } from "@/modules/smg-syslog/purge";

const dirs: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "smg-syslog-bytes-"));
  dirs.push(dir);
  return dir;
}

function writeSlot(
  root: string,
  ip: string,
  year: string,
  month: string,
  day: string,
  hour: string,
  file: string,
  contents: string,
): string {
  const dir = path.join(root, ip, year, month, day, hour);
  mkdirSync(dir, { recursive: true });
  const full = path.join(dir, file);
  writeFileSync(full, contents);
  return full;
}

afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("sumSyslogStoredBytes", () => {
  it("sums every saved slot of one device", async () => {
    const root = tempRoot();
    const outside = tempRoot();
    writeSlot(root, "10.1.2.3", "2026", "10", "14", "19", "40.log.gz", "abcd");
    writeSlot(root, "10.1.2.3", "2026", "10", "15", "07", "20.log", "xy");
    writeSlot(root, "10.1.2.3", "2026", "10", "15", "07", "20.log.gz", "z");
    writeSlot(root, "10.1.2.3", "2026", "10", "15", "07", "00.log.gz.partial", "skip-me");
    writeSlot(root, "10.1.2.3", "2026", "10", "15", "07", "notes.txt", "no");
    writeFileSync(path.join(root, "10.1.2.3", "loose.log"), "root-file");
    writeSlot(root, "10.9.9.9", "2026", "10", "15", "07", "00.log", "other");

    const leaked = path.join(outside, "secret");
    mkdirSync(path.join(leaked, "01", "02", "03"), { recursive: true });
    writeFileSync(path.join(leaked, "01", "02", "03", "00.log"), "0123456789");
    symlinkSync(leaked, path.join(root, "10.1.2.3", "2024"));
    symlinkSync(
      path.join(leaked, "01", "02", "03", "00.log"),
      path.join(root, "10.1.2.3", "2026", "10", "15", "07", "10.log"),
    );

    expect(await sumSyslogStoredBytes(root, "10.1.2.3")).toBe(7);
  });

  it("returns 0 when the device directory does not exist", async () => {
    const root = tempRoot();
    expect(await sumSyslogStoredBytes(root, "10.1.2.3")).toBe(0);
  });

  it("returns null for a path that leaves the volume or is not a directory", async () => {
    const root = tempRoot();
    writeFileSync(path.join(root, "10.2.2.2"), "not-a-dir");
    expect(await sumSyslogStoredBytes(root, "../secret")).toBeNull();
    expect(await sumSyslogStoredBytes(root, "10.2.2.2")).toBeNull();
  });
});

describe("readSyslogStoredBytes", () => {
  it("keeps the cached total until invalidate", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T00:00:00.000Z"));
    const root = tempRoot();
    const file = writeSlot(root, "10.1.2.3", "2026", "10", "15", "07", "00.log", "a");
    expect(await readSyslogStoredBytes(root, "10.1.2.3")).toBe(1);

    writeFileSync(file, "abcd");
    vi.setSystemTime(new Date("2026-10-15T00:00:10.000Z"));
    expect(await readSyslogStoredBytes(root, "10.1.2.3")).toBe(1);

    invalidateSyslogStoredBytes(root, "10.1.2.3");
    expect(await readSyslogStoredBytes(root, "10.1.2.3")).toBe(4);
  });

  it("refreshes a stale total without hiding the previous figure", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T00:00:00.000Z"));
    const root = tempRoot();
    const file = writeSlot(root, "10.1.2.3", "2026", "10", "15", "07", "00.log", "a");
    expect(await readSyslogStoredBytes(root, "10.1.2.3")).toBe(1);
    writeFileSync(file, "abcd");
    vi.setSystemTime(new Date(Date.now() + SYSLOG_STORED_BYTES_TTL_MS + 1));
    expect(await readSyslogStoredBytes(root, "10.1.2.3")).toBe(1);

    let seen: number | null = null;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      seen = await readSyslogStoredBytes(root, "10.1.2.3");
      if (seen === 4) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(seen).toBe(4);
  });
});

describe("purge drops the cached syslog volume", () => {
  it("returns the remaining bytes on the next read", async () => {
    const root = tempRoot();
    writeSlot(root, "10.1.2.3", "2026", "08", "02", "01", "10.log.gz", "aaaa");
    writeSlot(root, "10.1.2.3", "2026", "09", "03", "04", "20.log", "ccc");
    writeSlot(root, "10.1.2.3", "2026", "10", "15", "07", "30.log", "bb");
    expect(await readSyslogStoredBytes(root, "10.1.2.3")).toBe(9);
    const result = await purgeSyslogBefore(
      root,
      "10.1.2.3",
      { year: "2026", month: "09" },
      new Date("2026-10-15T07:44:06Z"),
    );
    expect(result.ok).toBe(true);
    expect(await readSyslogStoredBytes(root, "10.1.2.3")).toBe(5);
  });
});
