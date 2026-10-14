import {
  closeSync,
  createReadStream,
  fstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { canonicalIpv4 } from "@/modules/smg-syslog/ip";
import { monthNominative } from "@/modules/traffic/month-labels";

const SLOTS = new Set(["00", "10", "20", "30", "40", "50"]);

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
  return joined;
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
    const next = safeJoin(dir, segment);
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
    const slot = archived ? name.slice(0, -".log.gz".length) : name.slice(0, -".log".length);
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
    existing.bytes = size;
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
    const next = safeJoin(dir, segment);
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
  const stream = Readable.from(concatStreams(gunzip, log));
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
): AsyncGenerator<Buffer> {
  for await (const chunk of first) {
    yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  }
  for await (const chunk of second) {
    yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  }
}

/** Test helper: a path that escapes the device directory is refused. */
export function readFileHead(file: string, max: number): Buffer {
  const fd = openSync(file, "r");
  try {
    const size = Math.min(max, fstatSync(fd).size);
    const buf = Buffer.alloc(max);
    const n = readSync(fd, buf, 0, size, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}
