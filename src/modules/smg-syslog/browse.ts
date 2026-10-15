import {
  createReadStream,
  lstatSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { bucketOf } from "@/modules/smg-syslog/bucket";
import { syslogLineFeed } from "@/modules/smg-syslog/frame";
import { canonicalIpv4, looksLikeDockerBridge } from "@/modules/smg-syslog/ip";
import { formatMonthNominative, monthNominative } from "@/modules/traffic/month-labels";

const SLOTS = new Set(["00", "10", "20", "30", "40", "50"]);
const BRIDGE_DEVICE_NAME = "Мост Docker";

export function isDockerBridgeDevice(ip: string): boolean {
  const canonical = canonicalIpv4(ip);
  return canonical != null && looksLikeDockerBridge(canonical);
}

/** Bridge directories are visible even though they are not registered nodes. */
export function withBridgeDevices(
  nodes: { ip: string; name: string }[],
  root: string,
): { ip: string; name: string }[] {
  const seen = new Set(nodes.map((node) => node.ip));
  return [...nodes, ...listBridgeDevices(root).filter((device) => !seen.has(device.ip))];
}

function listBridgeDevices(root: string): { ip: string; name: string }[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && looksLikeDockerBridge(entry.name))
      .map((entry) => entry.name)
      .sort()
      .map((ip) => ({ ip, name: BRIDGE_DEVICE_NAME }));
  } catch {
    return [];
  }
}

export type SyslogFolder = {
  name: string;
  label: string;
};

export type SyslogFileRow = {
  slot: string;
  label: string;
  bytes: number;
  /** archive = .gz only, open = raw log, updating = both while a rebuild runs */
  state: "archive" | "open" | "updating";
};

export type SyslogList =
  | { kind: "folders"; folders: SyslogFolder[] }
  | { kind: "files"; files: SyslogFileRow[] };

export type SyslogDownload =
  | {
      kind: "file";
      absPath: string;
      size: number;
      filename: string;
      contentType: string;
    }
  | {
      kind: "combined";
      gzPath: string;
      logPath: string;
      logSize: number;
      filename: string;
    };

function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function deviceDir(root: string, device: string): string | null {
  const ip = canonicalIpv4(device);
  if (!ip) return null;
  let rootReal: string;
  try {
    rootReal = realpathSync(root);
  } catch {
    return null;
  }
  const joined = path.resolve(rootReal, ip);
  if (!isInsideRoot(rootReal, joined)) return null;
  try {
    if (lstatSync(joined).isSymbolicLink()) return null;
  } catch {
    /* missing directory is an empty device, not an error */
  }
  return joined;
}

/** Real device directory, a not-yet-created one, or an unusable path. */
export function syslogDeviceLocation(
  root: string,
  device: string,
):
  | { status: "invalid" }
  | { status: "missing"; dir: string }
  | { status: "directory"; dir: string } {
  const dir = deviceDir(root, device);
  if (!dir) return { status: "invalid" };
  try {
    const stat = lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return { status: "invalid" };
    return { status: "directory", dir };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { status: "missing", dir };
    return { status: "invalid" };
  }
}

function yearOk(value: string | undefined): value is string {
  return !!value && /^\d{4}$/.test(value);
}

function monthOk(value: string | undefined): value is string {
  if (!value || !/^\d{2}$/.test(value)) return false;
  const month = Number(value);
  return month >= 1 && month <= 12;
}

function dayOk(value: string | undefined): value is string {
  if (!value || !/^\d{2}$/.test(value)) return false;
  const day = Number(value);
  return day >= 1 && day <= 31;
}

function hourOk(value: string | undefined): value is string {
  if (!value || !/^\d{2}$/.test(value)) return false;
  const hour = Number(value);
  return hour >= 0 && hour <= 23;
}

function slotOk(value: string | undefined): value is string {
  return !!value && SLOTS.has(value);
}

function safeJoin(dir: string, name: string): string | null {
  if (name.startsWith(".") || name.includes("/") || name.includes("\\")) return null;
  const joined = path.resolve(dir, name);
  if (!isInsideRoot(dir, joined) && path.dirname(joined) !== dir) return null;
  return joined;
}

/** Next path segment. A symlink is refused. A missing directory is kept so the list stays empty. */
function stepInto(dir: string, segment: string): string | null {
  const next = safeJoin(dir, segment);
  if (!next) return null;
  try {
    if (lstatSync(next).isSymbolicLink()) return null;
  } catch {
    return next;
  }
  return next;
}

function readNames(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function folderLabel(level: "year" | "month" | "day" | "hour", name: string): string {
  if (level === "month") {
    const month = Number(name);
    if (month >= 1 && month <= 12) return monthNominative(month);
  }
  return name;
}

/**
 * One directory level under a registered device.
 * Missing directories are an empty list, not an error.
 */
export function listSyslogLevel(
  root: string,
  device: string,
  parts: { year?: string; month?: string; day?: string; hour?: string },
): SyslogList | null {
  const base = deviceDir(root, device);
  if (!base) return null;
  const segments: string[] = [];
  if (parts.year != null) {
    if (!yearOk(parts.year)) return null;
    segments.push(parts.year);
  }
  if (parts.month != null) {
    if (!monthOk(parts.month) || segments.length !== 1) return null;
    segments.push(parts.month);
  }
  if (parts.day != null) {
    if (!dayOk(parts.day) || segments.length !== 2) return null;
    segments.push(parts.day);
  }
  if (parts.hour != null) {
    if (!hourOk(parts.hour) || segments.length !== 3) return null;
    segments.push(parts.hour);
  }

  let dir = base;
  for (const segment of segments) {
    const next = stepInto(dir, segment);
    if (!next) return null;
    dir = next;
  }

  if (segments.length < 4) {
    const level = (["year", "month", "day", "hour"] as const)[segments.length] ?? "year";
    const folders = readNames(dir)
      .filter((name) => !name.startsWith("."))
      .filter((name) => {
        if (level === "year") return yearOk(name);
        if (level === "month") return monthOk(name);
        if (level === "day") return dayOk(name);
        return hourOk(name);
      })
      .sort()
      .map((name) => ({ name, label: folderLabel(level, name) }));
    return { kind: "folders", folders };
  }

  const bySlot = new Map<string, SyslogFileRow>();
  for (const name of readNames(dir)) {
    if (name.startsWith(".") || name.endsWith(".partial")) continue;
    const archived = name.endsWith(".log.gz");
    const raw = name.endsWith(".log");
    if (!archived && !raw) continue;
    const slot = archived
      ? name.slice(0, -".log.gz".length)
      : name.slice(0, -".log".length);
    if (!slotOk(slot)) continue;
    const full = safeJoin(dir, name);
    if (!full) continue;
    let size = 0;
    try {
      size = statSync(full).size;
    } catch {
      continue;
    }
    const existing = bySlot.get(slot);
    if (!existing) {
      bySlot.set(slot, {
        slot,
        label: slot,
        bytes: size,
        state: archived ? "archive" : "open",
      });
      continue;
    }
    existing.state = "updating";
    existing.bytes += size;
  }
  const files = [...bySlot.values()].sort((a, b) => a.slot.localeCompare(b.slot));
  return { kind: "files", files };
}

export function openSyslogDownload(
  root: string,
  device: string,
  parts: { year: string; month: string; day: string; hour: string; slot: string },
): SyslogDownload | null {
  if (!yearOk(parts.year) || !monthOk(parts.month) || !dayOk(parts.day)) return null;
  if (!hourOk(parts.hour) || !slotOk(parts.slot)) return null;
  const base = deviceDir(root, device);
  if (!base) return null;
  let dir = base;
  for (const segment of [parts.year, parts.month, parts.day, parts.hour]) {
    const next = stepInto(dir, segment);
    if (!next) return null;
    dir = next;
  }
  const logName = `${parts.slot}.log`;
  const gzName = `${parts.slot}.log.gz`;
  const logPath = safeJoin(dir, logName);
  const gzPath = safeJoin(dir, gzName);
  if (!logPath || !gzPath) return null;
  const ip = canonicalIpv4(device);
  if (!ip) return null;
  const filename = `${ip}_${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.slot}`;
  const logExists = existsFile(logPath);
  const gzExists = existsFile(gzPath);
  if (gzExists && logExists) {
    if (!fileStaysInside(root, gzPath) || !fileStaysInside(root, logPath)) return null;
    return {
      kind: "combined",
      gzPath,
      logPath,
      logSize: statSync(logPath).size,
      filename: `${filename}.log`,
    };
  }
  if (gzExists) {
    if (!fileStaysInside(root, gzPath)) return null;
    const size = statSync(gzPath).size;
    return {
      kind: "file",
      absPath: gzPath,
      size,
      filename: `${filename}.log.gz`,
      contentType: "application/gzip",
    };
  }
  if (logExists) {
    if (!fileStaysInside(root, logPath)) return null;
    const size = statSync(logPath).size;
    return {
      kind: "file",
      absPath: logPath,
      size,
      filename: `${filename}.log`,
      contentType: "text/plain; charset=utf-8",
    };
  }
  return null;
}

function existsFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function fileStaysInside(root: string, file: string): boolean {
  try {
    const rootReal = realpathSync(root);
    const fileReal = realpathSync(file);
    return isInsideRoot(rootReal, fileReal);
  } catch {
    return false;
  }
}

export function streamDownload(download: SyslogDownload): {
  stream: Readable;
  filename: string;
  contentType: string;
  size: number | null;
} {
  if (download.kind === "file") {
    if (download.size === 0) {
      return {
        stream: Readable.from([]),
        filename: download.filename,
        contentType: download.contentType,
        size: 0,
      };
    }
    const nodeStream = createReadStream(download.absPath, {
      start: 0,
      end: download.size - 1,
    });
    return {
      stream: nodeStream,
      filename: download.filename,
      contentType: download.contentType,
      size: download.size,
    };
  }
  const gunzip = createGunzip();
  createReadStream(download.gzPath).pipe(gunzip);
  const log =
    download.logSize === 0
      ? Readable.from([])
      : createReadStream(download.logPath, { start: 0, end: download.logSize - 1 });
  const stream = Readable.from(concatStreams(gunzip, log, download.logSize));
  return {
    stream,
    filename: download.filename,
    contentType: "text/plain; charset=utf-8",
    size: null,
  };
}

async function* concatStreams(
  first: Readable,
  second: Readable,
  secondBytes: number,
): AsyncGenerator<Buffer> {
  let last: number | null = null;
  for await (const chunk of first) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (buf.length > 0) last = buf[buf.length - 1] ?? null;
    yield buf;
  }
  if (secondBytes > 0 && last != null && last !== 0x0a) yield Buffer.from(syslogLineFeed);
  for await (const chunk of second) {
    yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  }
}

export type SyslogChoice = { name: string; label: string };

export type SyslogSelected = { year: string; month: string; day: string; hour: string };

export type SyslogCascade = {
  years: SyslogChoice[];
  months: SyslogChoice[];
  days: SyslogChoice[];
  hours: SyslogChoice[];
  files: SyslogFileRow[];
  selected: SyslogSelected | null;
};

export type SyslogPurgeMonth = { year: string; month: string; label: string };

export function emptySyslogCascade(): SyslogCascade {
  return { years: [], months: [], days: [], hours: [], files: [], selected: null };
}

function isSlotFileName(name: string): boolean {
  if (name.endsWith(".partial")) return false;
  const archived = name.endsWith(".log.gz");
  const raw = name.endsWith(".log") && !archived;
  if (!archived && !raw) return false;
  const slot = archived
    ? name.slice(0, -".log.gz".length)
    : name.slice(0, -".log".length);
  return slotOk(slot);
}

/** True when a real directory contains a slot file. Symlinks are not opened. */
function containsSlot(dir: string): boolean {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (containsSlot(path.join(dir, entry.name))) return true;
      continue;
    }
    if (entry.isFile() && isSlotFileName(entry.name)) return true;
  }
  return false;
}

function nameOk(level: "year" | "month" | "day" | "hour", name: string): boolean {
  if (level === "year") return yearOk(name);
  if (level === "month") return monthOk(name);
  if (level === "day") return dayOk(name);
  return hourOk(name);
}

function choices(dir: string, level: "year" | "month" | "day" | "hour"): SyslogChoice[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    if (!entry.isDirectory() || !nameOk(level, entry.name)) continue;
    if (!containsSlot(path.join(dir, entry.name))) continue;
    names.push(entry.name);
  }
  names.sort((a, b) => (level === "year" ? b.localeCompare(a) : a.localeCompare(b)));
  return names.map((name) => ({ name, label: folderLabel(level, name) }));
}

function pickDesc(
  names: string[],
  requested: string | undefined,
): { value: string | null; kept: boolean } {
  if (names.length === 0) return { value: null, kept: false };
  if (requested && names.includes(requested)) return { value: requested, kept: true };
  return { value: names[0] ?? null, kept: false };
}

function pickAsc(
  names: string[],
  requested: string | undefined,
  keep: boolean,
): { value: string | null; kept: boolean } {
  if (names.length === 0) return { value: null, kept: false };
  if (keep && requested && names.includes(requested))
    return { value: requested, kept: true };
  return { value: names[names.length - 1] ?? null, kept: false };
}

/**
 * Years, then months, days, hours and slots inside the chosen path.
 * An omitted or missing part selects the latest value that exists to its right.
 * Returns null when the device path is not a real directory.
 */
export function listSyslogCascade(
  root: string,
  device: string,
  requested: { year?: string; month?: string; day?: string; hour?: string },
): SyslogCascade | null {
  const located = syslogDeviceLocation(root, device);
  if (located.status === "invalid") return null;
  if (located.status === "missing") return emptySyslogCascade();

  const years = choices(located.dir, "year");
  const yearPick = pickDesc(
    years.map((row) => row.name),
    requested.year,
  );
  const months = yearPick.value
    ? choices(path.join(located.dir, yearPick.value), "month")
    : [];
  const monthPick = pickAsc(
    months.map((row) => row.name),
    requested.month,
    yearPick.kept,
  );
  const days =
    yearPick.value && monthPick.value
      ? choices(path.join(located.dir, yearPick.value, monthPick.value), "day")
      : [];
  const dayPick = pickAsc(
    days.map((row) => row.name),
    requested.day,
    monthPick.kept,
  );
  const hours =
    yearPick.value && monthPick.value && dayPick.value
      ? choices(
          path.join(located.dir, yearPick.value, monthPick.value, dayPick.value),
          "hour",
        )
      : [];
  const hourPick = pickAsc(
    hours.map((row) => row.name),
    requested.hour,
    dayPick.kept,
  );

  let files: SyslogFileRow[] = [];
  if (yearPick.value && monthPick.value && dayPick.value && hourPick.value) {
    const listed = listSyslogLevel(root, device, {
      year: yearPick.value,
      month: monthPick.value,
      day: dayPick.value,
      hour: hourPick.value,
    });
    if (listed?.kind === "files") files = listed.files;
  }

  const selected =
    yearPick.value && monthPick.value && dayPick.value && hourPick.value
      ? {
          year: yearPick.value,
          month: monthPick.value,
          day: dayPick.value,
          hour: hourPick.value,
        }
      : null;
  return { years, months, days, hours, files, selected };
}

/** Complete months with at least one slot, strictly before the UTC month of `now`. */
export function listSyslogPurgeMonths(
  root: string,
  device: string,
  now: Date,
): SyslogPurgeMonth[] | null {
  const located = syslogDeviceLocation(root, device);
  if (located.status === "invalid") return null;
  if (located.status === "missing") return [];
  const current = bucketOf(now, 0);
  const currentKey = Number(current.year) * 12 + Number(current.month);
  const months: SyslogPurgeMonth[] = [];
  for (const year of choices(located.dir, "year")) {
    for (const month of choices(path.join(located.dir, year.name), "month")) {
      const key = Number(year.name) * 12 + Number(month.name);
      if (key >= currentKey) continue;
      months.push({
        year: year.name,
        month: month.name,
        label: formatMonthNominative(Number(year.name), Number(month.name)),
      });
    }
  }
  months.sort((a, b) => b.year.localeCompare(a.year) || b.month.localeCompare(a.month));
  return months;
}

/** Longer than the syslog page poll, so an open tab does not stat every file each time. */
export const SYSLOG_STORED_BYTES_TTL_MS = 15_000;

type StoredByteCache = { bytes: number; at: number; generation: number };
type StoredByteFlight = { generation: number; promise: Promise<void> };

const storedByteCache = new Map<string, StoredByteCache>();
const storedByteFlight = new Map<string, StoredByteFlight>();
const storedByteGeneration = new Map<string, number>();

function storedByteKey(root: string, ip: string): string {
  return `${root}\0${ip}`;
}

const SLOT_LEVELS = ["year", "month", "day", "hour"] as const;

/**
 * Logical size of every saved slot under one device, matching the hour table.
 * A missing directory is 0. An unusable path, or a device directory that cannot
 * be read, is null.
 */
export async function sumSyslogStoredBytes(
  root: string,
  device: string,
): Promise<number | null> {
  const located = syslogDeviceLocation(root, device);
  if (located.status === "invalid") return null;
  if (located.status === "missing") return 0;
  try {
    return await sumSlotBytes(located.dir, 0);
  } catch {
    return null;
  }
}

async function sumSlotBytes(dir: string, depth: number): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (depth === 0 && code !== "ENOENT") throw error;
    return 0;
  }
  let total = 0;
  if (depth < SLOT_LEVELS.length) {
    const level = SLOT_LEVELS[depth] ?? "year";
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      if (!entry.isDirectory() || !nameOk(level, entry.name)) continue;
      total += await sumSlotBytes(path.join(dir, entry.name), depth + 1);
    }
    return total;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    if (!entry.isFile() || !isSlotFileName(entry.name)) continue;
    try {
      const stat = await lstat(path.join(dir, entry.name));
      if (stat.isSymbolicLink() || !stat.isFile()) continue;
      total += stat.size;
    } catch {
      continue;
    }
  }
  return total;
}

function storedByteGenerationOf(key: string): number {
  return storedByteGeneration.get(key) ?? 0;
}

function startStoredByteRefresh(root: string, ip: string, key: string): Promise<void> {
  const generation = storedByteGenerationOf(key);
  const current = storedByteFlight.get(key);
  if (current?.generation === generation) return current.promise;
  const flight: StoredByteFlight = {
    generation,
    promise: sumSyslogStoredBytes(root, ip).then(
      (bytes) => {
        if (storedByteGenerationOf(key) !== generation) return;
        const previous = storedByteCache.get(key);
        if (bytes == null) {
          if (previous?.generation === generation) {
            storedByteCache.set(key, { ...previous, at: Date.now() });
          }
          return;
        }
        storedByteCache.set(key, { bytes, at: Date.now(), generation });
      },
      () => {
        /* keep the previous total; the next read tries again */
      },
    ),
  };
  storedByteFlight.set(key, flight);
  void flight.promise.finally(() => {
    if (storedByteFlight.get(key) === flight) storedByteFlight.delete(key);
  });
  return flight.promise;
}

/**
 * Total for the syslog page. A fresh cache entry is returned immediately.
 * After the TTL the previous total is returned while one walk refreshes it.
 * The first read of a device waits for the walk. A walk that started before
 * `invalidateSyslogStoredBytes` does not write the cache.
 */
export async function readSyslogStoredBytes(
  root: string,
  device: string,
): Promise<number | null> {
  const ip = canonicalIpv4(device);
  if (!ip) return null;
  const key = storedByteKey(root, ip);
  const generation = storedByteGenerationOf(key);
  const hit = storedByteCache.get(key);
  if (
    hit?.generation === generation &&
    Date.now() - hit.at < SYSLOG_STORED_BYTES_TTL_MS
  ) {
    return hit.bytes;
  }
  if (hit?.generation === generation) {
    void startStoredByteRefresh(root, ip, key);
    return hit.bytes;
  }
  await startStoredByteRefresh(root, ip, key);
  const next = storedByteCache.get(key);
  if (next?.generation === storedByteGenerationOf(key)) return next.bytes;
  return null;
}

/** Forget one device. An in-flight walk from before this call cannot store. */
export function invalidateSyslogStoredBytes(root: string, device: string): void {
  const ip = canonicalIpv4(device);
  if (!ip) return;
  const key = storedByteKey(root, ip);
  storedByteGeneration.set(key, storedByteGenerationOf(key) + 1);
  storedByteCache.delete(key);
}
