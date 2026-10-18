import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  invalidateSyslogMonthInventory,
  listSyslogMonthInventory,
  listSyslogMonthTargets,
} from "@/modules/smg-syslog/month-inventory";

const dirs: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "smg-syslog-months-"));
  dirs.push(dir);
  return dir;
}

function slot(
  root: string,
  ip: string,
  year: string,
  month: string,
  file: string,
  body = "x",
): void {
  const dir = path.join(root, ip, year, month, "01", "00");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, file), body);
}

afterEach(() => {
  invalidateSyslogMonthInventory();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("syslog month inventory", () => {
  it("sums slot bytes across devices and keeps a partial-only month", async () => {
    const root = tempRoot();
    slot(root, "10.1.2.3", "2026", "08", "00.log", "abcd");
    slot(root, "172.17.0.1", "2026", "08", "10.log.gz", "zz");
    slot(root, "10.1.2.3", "2026", "08", "00.log.gz.partial", "partial");
    slot(root, "10.9.9.9", "2026", "09", "20.log", "yyyy");
    mkdirSync(path.join(root, "not-an-ip", "2026", "07", "01"), { recursive: true });
    writeFileSync(path.join(root, "not-an-ip", "2026", "07", "01", "00.log"), "no");

    const rows = await listSyslogMonthInventory(root);
    const august = rows.find((row) => row.key === "2026-08");
    expect(august).toMatchObject({ bytes: 6, files: 2, present: true });
    expect(rows.find((row) => row.key === "2026-09")).toMatchObject({ bytes: 4, files: 1 });
    expect(rows.find((row) => row.key === "2026-07")).toBeUndefined();
  });

  it("lists a month that has only a partial archive", async () => {
    const root = tempRoot();
    slot(root, "10.1.2.3", "2026", "08", "00.log.gz.partial");
    const rows = await listSyslogMonthInventory(root);
    expect(rows).toEqual([
      expect.objectContaining({ key: "2026-08", bytes: 0, files: 0, present: true }),
    ]);
    const targets = await listSyslogMonthTargets(root, 2026, 8);
    expect(targets.map((target) => target.ip)).toEqual(["10.1.2.3"]);
  });

  it("does not follow a device symlink", async () => {
    const root = tempRoot();
    const outside = tempRoot();
    slot(outside, "10.1.2.3", "2026", "08", "00.log", "secret");
    symlinkSync(path.join(outside, "10.1.2.3"), path.join(root, "10.1.2.3"));
    expect(await listSyslogMonthInventory(root)).toEqual([]);
  });
});
