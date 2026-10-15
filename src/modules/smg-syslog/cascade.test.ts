import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listSyslogCascade, listSyslogPurgeMonths } from "@/modules/smg-syslog/browse";

const dirs: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "smg-syslog-cascade-"));
  dirs.push(dir);
  return dir;
}

function slot(
  root: string,
  ip: string,
  year: string,
  month: string,
  day: string,
  hour: string,
  file = "00.log",
): void {
  const dir = path.join(root, ip, year, month, day, hour);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, file), "x");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("syslog cascade", () => {
  it("picks the latest year, month, day and hour when nothing is requested", () => {
    const root = tempRoot();
    slot(root, "10.1.2.3", "2025", "12", "31", "22", "50.log");
    slot(root, "10.1.2.3", "2026", "01", "02", "03", "10.log");
    slot(root, "10.1.2.3", "2026", "10", "14", "19", "40.log.gz");
    slot(root, "10.1.2.3", "2026", "10", "15", "07", "20.log");
    const list = listSyslogCascade(root, "10.1.2.3", {});
    expect(list?.years.map((row) => row.name)).toEqual(["2026", "2025"]);
    expect(list?.months.map((row) => row.label)).toEqual(["Январь", "Октябрь"]);
    expect(list?.days.map((row) => row.name)).toEqual(["14", "15"]);
    expect(list?.hours.map((row) => row.name)).toEqual(["07"]);
    expect(list?.files.map((row) => row.slot)).toEqual(["20"]);
    expect(list?.selected).toEqual({ year: "2026", month: "10", day: "15", hour: "07" });
  });

  it("keeps an older year and selects the latest month, day and hour inside it", () => {
    const root = tempRoot();
    slot(root, "10.1.2.3", "2025", "02", "01", "00", "00.log");
    slot(root, "10.1.2.3", "2025", "11", "09", "04", "10.log");
    slot(root, "10.1.2.3", "2025", "11", "20", "18", "50.log");
    slot(root, "10.1.2.3", "2026", "10", "15", "07", "00.log");
    const list = listSyslogCascade(root, "10.1.2.3", { year: "2025" });
    expect(list?.selected).toEqual({ year: "2025", month: "11", day: "20", hour: "18" });
    expect(list?.files.map((file) => file.slot)).toEqual(["50"]);
  });

  it("keeps a chosen hour and does not jump to a newer one", () => {
    const root = tempRoot();
    slot(root, "10.1.2.3", "2026", "10", "15", "03", "00.log");
    slot(root, "10.1.2.3", "2026", "10", "15", "07", "10.log");
    const list = listSyslogCascade(root, "10.1.2.3", {
      year: "2026",
      month: "10",
      day: "15",
      hour: "03",
    });
    expect(list?.selected?.hour).toBe("03");
    expect(list?.hours.map((row) => row.name)).toEqual(["03", "07"]);
    expect(list?.files.map((file) => file.slot)).toEqual(["00"]);
  });

  it("hides a directory that only has a partial archive", () => {
    const root = tempRoot();
    slot(root, "10.1.2.3", "2026", "10", "15", "07", "00.log.gz.partial");
    slot(root, "10.1.2.3", "2026", "10", "15", "08", "10.log");
    const list = listSyslogCascade(root, "10.1.2.3", {});
    expect(list?.hours.map((row) => row.name)).toEqual(["08"]);
    expect(list?.files.map((file) => file.slot)).toEqual(["10"]);
  });

  it("does not follow a symlinked year and does not remove files", () => {
    const root = tempRoot();
    const outside = tempRoot();
    slot(root, "10.1.2.3", "2026", "10", "15", "07", "00.log");
    const target = path.join(outside, "secret");
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "keep.txt"), "stay");
    symlinkSync(target, path.join(root, "10.1.2.3", "2024"));
    const before = existsSync(path.join(target, "keep.txt"));
    const list = listSyslogCascade(root, "10.1.2.3", {});
    expect(list?.years.map((row) => row.name)).toEqual(["2026"]);
    expect(before).toBe(true);
    expect(existsSync(path.join(target, "keep.txt"))).toBe(true);
    expect(
      existsSync(path.join(root, "10.1.2.3", "2026", "10", "15", "07", "00.log")),
    ).toBe(true);
  });

  it("rejects a device path that leaves the volume", () => {
    const root = tempRoot();
    expect(listSyslogCascade(root, "../secret", {})).toBeNull();
  });
});

describe("syslog purge months", () => {
  it("lists only complete months, newest first, and skips the current UTC month", () => {
    const root = tempRoot();
    slot(root, "10.1.2.3", "2025", "12", "01", "00", "00.log");
    slot(root, "10.1.2.3", "2026", "08", "02", "01", "10.log.gz");
    slot(root, "10.1.2.3", "2026", "10", "15", "07", "20.log");
    mkdirSync(path.join(root, "10.1.2.3", "2026", "07"), { recursive: true });
    const months = listSyslogPurgeMonths(
      root,
      "10.1.2.3",
      new Date("2026-10-15T07:44:06Z"),
    );
    expect(months?.map((month) => month.label)).toEqual([
      "Август 2026 года",
      "Декабрь 2025 года",
    ]);
  });
});
