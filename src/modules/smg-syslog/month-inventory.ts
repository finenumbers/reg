import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { SYSLOG_STORED_BYTES_TTL_MS } from "@/modules/smg-syslog/browse";
import { canonicalIpv4 } from "@/modules/smg-syslog/ip";
import { monthKey } from "@/modules/traffic/cdr-month";

const SLOTS = new Set(["00", "10", "20", "30", "40", "50"]);
const YEAR = /^\d{4}$/;
const MONTH = /^(?:0[1-9]|1[0-2])$/;

export type SyslogMonthStat = {
  year: number;
  month: number;
  key: string;
  /** Saved slot bytes. A partial archive is not included. */
  bytes: number;
  files: number;
  /** True when the month directory holds any non-hidden file, including a partial. */
  present: boolean;
};

export type SyslogMonthTarget = {
  ip: string;
  yearDir: string;
  monthDir: string;
  files: number;
};

type Cache = {
  root: string;
  at: number;
  generation: number;
  rows: SyslogMonthStat[];
};

let generation = 0;
let cache: Cache | null = null;
let flight: { generation: number; root: string; promise: Promise<SyslogMonthStat[]> } | null =
  null;

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

/** Drop the settings snapshot. An in-flight walk from before this call does not store. */
export function invalidateSyslogMonthInventory(): void {
  generation += 1;
  cache = null;
}

function isSlotFileName(name: string): boolean {
  if (name.endsWith(".partial")) return false;
  const archived = name.endsWith(".log.gz");
  const raw = name.endsWith(".log") && !archived;
  if (!archived && !raw) return false;
  const slot = archived ? name.slice(0, -".log.gz".length) : name.slice(0, -".log".length);
  return SLOTS.has(slot);
}

async function deviceNames(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (errno(error) === "ENOENT") return [];
    throw error;
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink() || !entry.isDirectory()) continue;
    const ip = canonicalIpv4(entry.name);
    if (!ip) continue;
    names.push(ip);
  }
  names.sort();
  return names;
}

async function inspectDir(dir: string): Promise<{ bytes: number; files: number; present: boolean }> {
  let bytes = 0;
  let files = 0;
  let present = false;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (errno(error) === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      present = true;
      if (!isSlotFileName(entry.name)) continue;
      const stat = await lstat(abs);
      if (stat.isSymbolicLink() || !stat.isFile()) continue;
      bytes += stat.size;
      files += 1;
    }
  }
  return { bytes, files, present };
}

async function readInventory(root: string): Promise<SyslogMonthStat[]> {
  const byKey = new Map<string, SyslogMonthStat>();
  for (const ip of await deviceNames(root)) {
    const deviceDir = path.join(root, ip);
    let years;
    try {
      years = await readdir(deviceDir, { withFileTypes: true });
    } catch (error) {
      if (errno(error) === "ENOENT") continue;
      throw error;
    }
    for (const yearEntry of years) {
      if (
        yearEntry.name.startsWith(".") ||
        yearEntry.isSymbolicLink() ||
        !yearEntry.isDirectory() ||
        !YEAR.test(yearEntry.name)
      ) {
        continue;
      }
      const yearDir = path.join(deviceDir, yearEntry.name);
      let months;
      try {
        months = await readdir(yearDir, { withFileTypes: true });
      } catch (error) {
        if (errno(error) === "ENOENT") continue;
        throw error;
      }
      for (const monthEntry of months) {
        if (
          monthEntry.name.startsWith(".") ||
          monthEntry.isSymbolicLink() ||
          !monthEntry.isDirectory() ||
          !MONTH.test(monthEntry.name)
        ) {
          continue;
        }
        const inspected = await inspectDir(path.join(yearDir, monthEntry.name));
        if (!inspected.present) continue;
        const year = Number(yearEntry.name);
        const month = Number(monthEntry.name);
        const key = monthKey(year, month);
        const row = byKey.get(key) ?? {
          year,
          month,
          key,
          bytes: 0,
          files: 0,
          present: false,
        };
        row.bytes += inspected.bytes;
        row.files += inspected.files;
        row.present = true;
        byKey.set(key, row);
      }
    }
  }
  return [...byKey.values()];
}

/** One walk of every device month. Cached for the syslog page interval. */
export async function listSyslogMonthInventory(root: string): Promise<SyslogMonthStat[]> {
  const gen = generation;
  if (
    cache &&
    cache.root === root &&
    cache.generation === gen &&
    Date.now() - cache.at < SYSLOG_STORED_BYTES_TTL_MS
  ) {
    return cache.rows;
  }
  if (flight && flight.generation === gen && flight.root === root) return flight.promise;
  const promise = readInventory(root).then((rows) => {
    if (generation === gen) cache = { root, at: Date.now(), generation: gen, rows };
    return rows;
  });
  flight = { generation: gen, root, promise };
  try {
    return await promise;
  } finally {
    if (flight?.promise === promise) flight = null;
  }
}

/** Month directories that hold a file, including a partial with no slot yet. */
export async function listSyslogMonthTargets(
  root: string,
  year: number,
  month: number,
): Promise<SyslogMonthTarget[]> {
  const yearName = String(year);
  const monthName = String(month).padStart(2, "0");
  const targets: SyslogMonthTarget[] = [];
  for (const ip of await deviceNames(root)) {
    const yearDir = path.join(root, ip, yearName);
    const monthDir = path.join(yearDir, monthName);
    let stat;
    try {
      stat = await lstat(monthDir);
    } catch (error) {
      if (errno(error) === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      targets.push({ ip, yearDir, monthDir, files: 0 });
      continue;
    }
    if (!stat.isDirectory()) continue;
    const inspected = await inspectDir(monthDir);
    if (!inspected.present) continue;
    targets.push({ ip, yearDir, monthDir, files: inspected.files });
  }
  return targets;
}
