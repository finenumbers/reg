import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteSyslogMonth,
  eraseSyslogNode,
  purgeSyslogBefore,
  removeSyslogDeviceDirectory,
} from "@/modules/smg-syslog/purge";

const dirs: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "smg-syslog-purge-"));
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
): string {
  const dir = path.join(root, ip, year, month, day, hour);
  mkdirSync(dir, { recursive: true });
  const full = path.join(dir, file);
  writeFileSync(full, "x");
  return full;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("purge syslog before a month", () => {
  it("deletes months strictly before the cutoff and leaves the rest of the volume", async () => {
    const root = tempRoot();
    const older = slot(root, "10.1.2.3", "2025", "12", "01", "00", "00.log");
    const august = slot(root, "10.1.2.3", "2026", "08", "02", "01", "10.log.gz");
    const september = slot(root, "10.1.2.3", "2026", "09", "03", "04", "20.log");
    const current = slot(root, "10.1.2.3", "2026", "10", "15", "07", "30.log");
    const other = slot(root, "10.9.9.9", "2025", "01", "01", "00", "00.log");
    writeFileSync(path.join(root, ".status.json"), "{}\n");
    writeFileSync(path.join(root, ".volume-reset"), "marker\n");

    const now = new Date("2026-10-15T07:44:06Z");
    const result = await purgeSyslogBefore(
      root,
      "10.1.2.3",
      { year: "2026", month: "09" },
      now,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted).toEqual([
        { year: "2025", month: "12" },
        { year: "2026", month: "08" },
      ]);
    }
    expect(existsSync(older)).toBe(false);
    expect(existsSync(august)).toBe(false);
    expect(existsSync(path.join(root, "10.1.2.3", "2025"))).toBe(false);
    expect(existsSync(september)).toBe(true);
    expect(existsSync(current)).toBe(true);
    expect(existsSync(other)).toBe(true);
    expect(readFileSync(path.join(root, ".status.json"), "utf8")).toBe("{}\n");
    expect(readFileSync(path.join(root, ".volume-reset"), "utf8")).toBe("marker\n");

    const again = await purgeSyslogBefore(
      root,
      "10.1.2.3",
      { year: "2026", month: "09" },
      now,
    );
    expect(again).toEqual({ ok: true, deleted: [] });
  });

  it("rejects the current month and a future month", async () => {
    const root = tempRoot();
    slot(root, "10.1.2.3", "2026", "09", "01", "00", "00.log");
    slot(root, "10.1.2.3", "2026", "10", "15", "07", "00.log");
    const now = new Date("2026-10-15T00:00:00Z");
    const current = await purgeSyslogBefore(
      root,
      "10.1.2.3",
      { year: "2026", month: "10" },
      now,
    );
    expect(current.ok).toBe(false);
    const future = await purgeSyslogBefore(
      root,
      "10.1.2.3",
      { year: "2027", month: "01" },
      now,
    );
    expect(future.ok).toBe(false);
    expect(
      existsSync(path.join(root, "10.1.2.3", "2026", "09", "01", "00", "00.log")),
    ).toBe(true);
  });

  it("unlinks a symlinked month and does not remove the target", async () => {
    const root = tempRoot();
    const outside = tempRoot();
    const target = path.join(outside, "month");
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "keep.txt"), "stay");
    const year = path.join(root, "10.1.2.3", "2025");
    mkdirSync(year, { recursive: true });
    symlinkSync(target, path.join(year, "01"));
    slot(root, "10.1.2.3", "2026", "09", "01", "00", "00.log");
    const result = await purgeSyslogBefore(
      root,
      "10.1.2.3",
      { year: "2026", month: "09" },
      new Date("2026-10-15T00:00:00Z"),
    );
    expect(result.ok).toBe(true);
    expect(existsSync(path.join(year, "01"))).toBe(false);
    expect(readFileSync(path.join(target, "keep.txt"), "utf8")).toBe("stay");
  });

  it("rejects a path outside the device directory", async () => {
    const root = tempRoot();
    const result = await purgeSyslogBefore(
      root,
      "../secret",
      { year: "2026", month: "01" },
      new Date("2026-10-15T00:00:00Z"),
    );
    expect(result.ok).toBe(false);
  });
});

describe("remove syslog device directory", () => {
  it("removes the device tree and leaves the rest of the volume", async () => {
    const root = tempRoot();
    slot(root, "10.1.2.3", "2026", "10", "15", "07", "20.log");
    const other = slot(root, "10.9.9.9", "2026", "01", "01", "00", "00.log");
    writeFileSync(path.join(root, ".status.json"), "{}\n");
    writeFileSync(path.join(root, ".volume-reset"), "marker\n");
    expect(await removeSyslogDeviceDirectory(root, "10.1.2.3")).toBe("removed");
    expect(existsSync(path.join(root, "10.1.2.3"))).toBe(false);
    expect(existsSync(other)).toBe(true);
    expect(readFileSync(path.join(root, ".status.json"), "utf8")).toBe("{}\n");
    expect(await removeSyslogDeviceDirectory(root, "10.1.2.3")).toBe("missing");
  });

  it("unlinks a symlinked device directory without deleting the target", async () => {
    const root = tempRoot();
    const outside = tempRoot();
    writeFileSync(path.join(outside, "keep.txt"), "stay");
    symlinkSync(outside, path.join(root, "10.1.2.3"));
    expect(await removeSyslogDeviceDirectory(root, "10.1.2.3")).toBe("removed");
    expect(existsSync(path.join(root, "10.1.2.3"))).toBe(false);
    expect(readFileSync(path.join(outside, "keep.txt"), "utf8")).toBe("stay");
  });
});

describe("erase syslog node", () => {
  const row = { ip: "10.1.2.3", name: "Казань", identifier: "kazan" };

  it("deletes the row and the directory, including the open month", async () => {
    const root = tempRoot();
    slot(root, "10.1.2.3", "2026", "10", "15", "07", "20.log");
    let stored: typeof row | null = row;
    const result = await eraseSyslogNode({
      root,
      ip: row.ip,
      bridge: false,
      settleMs: 0,
      retryMs: 0,
      sleep: async () => {},
      loadNode: async () => stored,
      deleteNode: async () => {
        const current = stored;
        stored = null;
        return current;
      },
    });
    expect(result.ok).toBe(true);
    expect(stored).toBeNull();
    expect(existsSync(path.join(root, "10.1.2.3"))).toBe(false);
  });

  it("does not remove files when the address is registered again before the wipe", async () => {
    const root = tempRoot();
    const file = slot(root, "10.1.2.3", "2026", "10", "15", "07", "20.log");
    const result = await eraseSyslogNode({
      root,
      ip: row.ip,
      bridge: false,
      settleMs: 0,
      retryMs: 0,
      sleep: async () => {},
      loadNode: async () => row,
      deleteNode: async () => row,
    });
    expect(result).toMatchObject({ ok: false, code: "RECREATED" });
    expect(existsSync(file)).toBe(true);
  });

  it("does not remove a docker bridge that is not a node", async () => {
    const root = tempRoot();
    const file = slot(root, "172.17.0.1", "2026", "10", "15", "07", "20.log");
    const result = await eraseSyslogNode({
      root,
      ip: "172.17.0.1",
      bridge: true,
      settleMs: 0,
      retryMs: 0,
      sleep: async () => {},
      loadNode: async () => null,
      deleteNode: async () => null,
    });
    expect(result).toMatchObject({ ok: false, code: "BRIDGE" });
    expect(existsSync(file)).toBe(true);
  });

  it("removes a leftover directory when the row is already gone", async () => {
    const root = tempRoot();
    slot(root, "10.1.2.3", "2026", "01", "01", "00", "00.log");
    const result = await eraseSyslogNode({
      root,
      ip: row.ip,
      bridge: false,
      settleMs: 0,
      retryMs: 0,
      sleep: async () => {},
      loadNode: async () => null,
      deleteNode: async () => null,
    });
    expect(result).toMatchObject({ ok: true, leftover: true, filesRemoved: true });
    expect(existsSync(path.join(root, "10.1.2.3"))).toBe(false);
  });
});

describe("delete one syslog month", () => {
  it("refuses the current month", async () => {
    const root = tempRoot();
    const file = slot(root, "10.1.2.3", "2026", "10", "18", "00", "00.log");
    const seen: Array<[number, number]> = [];
    await expect(
      deleteSyslogMonth(root, 2026, 10, new Date("2026-10-18T12:00:00Z"), async (done, total) => {
        seen.push([done, total]);
      }),
    ).rejects.toThrow("Текущий месяц удалить нельзя");
    expect(existsSync(file)).toBe(true);
    expect(seen).toEqual([]);
  });

  it("removes that month on every device, including a partial, and leaves the device", async () => {
    const root = tempRoot();
    const gone = slot(root, "10.1.2.3", "2026", "08", "01", "00", "00.log");
    const partial = slot(root, "172.17.0.1", "2026", "08", "02", "00", "10.log.gz.partial");
    const stay = slot(root, "10.1.2.3", "2026", "09", "01", "00", "20.log");
    const outside = tempRoot();
    const secret = slot(outside, "10.4.4.4", "2026", "08", "01", "00", "00.log");
    symlinkSync(path.join(outside, "10.4.4.4"), path.join(root, "10.4.4.4"));
    const seen: Array<[number, number]> = [];
    const removed = await deleteSyslogMonth(
      root,
      2026,
      8,
      new Date("2026-10-18T12:00:00Z"),
      async (done, total) => {
        seen.push([done, total]);
      },
    );
    expect(removed).toBe(1);
    expect(existsSync(gone)).toBe(false);
    expect(existsSync(partial)).toBe(false);
    expect(existsSync(stay)).toBe(true);
    expect(existsSync(path.join(root, "10.1.2.3"))).toBe(true);
    expect(existsSync(secret)).toBe(true);
    expect(existsSync(path.join(root, "10.4.4.4"))).toBe(true);
    expect(seen[0]).toEqual([0, 1]);
    expect(seen.at(-1)).toEqual([1, 1]);
  });
});
