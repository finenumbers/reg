import { closeSync, createReadStream, openSync, readdirSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { PassThrough, type Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { logger } from "@/lib/logger";
import {
  applyLine,
  commitTraceFile,
  emptyTraceState,
  restoreTraceState,
  SMG_TRACE_PARSER_VERSION,
  type TraceSpan,
  type TraceState,
} from "@/modules/smg-trace/assemble";
import { bucketKey, bucketOf } from "@/modules/smg-syslog/bucket";
import { canonicalIpv4, looksLikeDockerBridge } from "@/modules/smg-syslog/ip";

const YEAR = /^\d{4}$/;
const MONTH = /^(?:0[1-9]|1[0-2])$/;
const DAY = /^(?:0[1-9]|[12]\d|3[01])$/;
const HOUR = /^(?:[01]\d|2[0-3])$/;

export type TraceSource = {
  deviceIp: string;
  fileKey: string;
  abs: string;
  gzip: boolean;
  size: number;
};

export type TraceCheckpointMeta = {
  fileKey: string;
  size: number;
  version: number;
};

/** Not a syslog file. The archive walker ignores it. */
export const LIVE_FILE_KEY = "@live";

export function isLiveFileKey(fileKey: string): boolean {
  return fileKey.startsWith("@");
}

export type TraceRepository = {
  /** Keys, sizes and assembler marks. Never the JSON state. */
  loadCheckpointMeta(deviceIp: string): Promise<TraceCheckpointMeta[]>;
  loadCheckpointState(deviceIp: string, fileKey: string): Promise<unknown | null>;
  /** Drop marks that are not the current version. Never reads their JSON. */
  deleteStaleCheckpoints(deviceIp: string): Promise<void>;
  /** Drop this gateway's cards. Used once, before a version-3 mark exists. */
  deleteCards(deviceIp: string): Promise<void>;
  saveSpan(deviceIp: string, span: TraceSpan): Promise<void>;
  saveCheckpoint(
    deviceIp: string,
    fileKey: string,
    size: number,
    state: unknown,
  ): Promise<void>;
};

type Tail = {
  key: string;
  offset: number;
  rawSize: number;
};

type LiveMark = {
  /** Keys strictly older than this are ignored. */
  floor: string;
  /** Null once `floor` itself is finished and must not be opened. */
  tail: Tail | null;
  slotIndex: number;
  slotKey: string;
  state: TraceState;
};

/** Floor key stored on the live mark, without the assembler JSON. */
export function readLiveFloor(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const floor = (state as { floor?: unknown }).floor;
  return typeof floor === "string" && floor.length > 0 ? floor : null;
}

export function listDeviceIps(root: string): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  const ips: string[] = [];
  for (const name of names) {
    const ip = canonicalIpv4(name);
    if (!ip || looksLikeDockerBridge(ip)) continue;
    ips.push(ip);
  }
  ips.sort();
  return ips;
}

/** Closed gzip buckets and the still-open raw log, oldest first. */
export function listTraceSources(root: string): TraceSource[] {
  const sources: TraceSource[] = [];
  for (const ip of listDeviceIps(root)) {
    collectDevice(path.join(root, ip), ip, sources);
  }
  sources.sort((a, b) => a.fileKey.localeCompare(b.fileKey));
  return sources;
}

/**
 * Files at or after `floor`. A missing floor is only the UTC slot that
 * contains `now`, so the first turn does not walk the archive.
 */
export function listTraceSourcesSince(
  root: string,
  deviceIp: string,
  floor: string | null,
  now: Date = new Date(),
): TraceSource[] {
  if (!floor) {
    const bucket = bucketOf(now, 0);
    const hourDir = path.join(root, deviceIp, bucket.year, bucket.month, bucket.day, bucket.hour);
    const picked = pickSlot(hourDir, bucket.slot);
    if (!picked) return [];
    return [
      {
        deviceIp,
        fileKey: `${deviceIp}/${bucketKey(bucket)}`,
        abs: picked.abs,
        gzip: picked.gzip,
        size: picked.size,
      },
    ];
  }
  const sources: TraceSource[] = [];
  collectSince(path.join(root, deviceIp), deviceIp, floor, sources);
  sources.sort((a, b) => a.fileKey.localeCompare(b.fileKey));
  return sources.filter((source) => source.fileKey >= floor);
}

/**
 * One chunk for this gateway. The first turn records the end of the newest
 * file and does not read it. Later turns read only bytes and slots after that
 * mark. Returns false when there is nothing to do.
 */
export async function stepDevice(
  deviceIp: string,
  files: readonly TraceSource[],
  repo: TraceRepository,
): Promise<boolean> {
  const saved = await repo.loadCheckpointMeta(deviceIp);
  const foreign = saved.some((row) => row.version !== SMG_TRACE_PARSER_VERSION);
  const hasLive = saved.some(
    (row) => row.fileKey === LIVE_FILE_KEY && row.version === SMG_TRACE_PARSER_VERSION,
  );
  if (foreign) {
    await repo.deleteStaleCheckpoints(deviceIp);
    if (!hasLive) await repo.deleteCards(deviceIp);
  }
  let mark = await loadMark(repo, deviceIp);
  if (!mark) {
    if (files.length === 0) return false;
    mark = seedMark(files);
    await repo.saveCheckpoint(deviceIp, LIVE_FILE_KEY, 0, mark);
    return true;
  }
  const job = nextJob(files, mark);
  if (!job) return false;
  if (job.kind === "close") {
    finishKey(mark, job.file.fileKey);
    await repo.saveCheckpoint(deviceIp, LIVE_FILE_KEY, 0, mark);
    return true;
  }
  if (job.file.fileKey !== mark.slotKey) {
    mark.slotIndex += 1;
    mark.slotKey = job.file.fileKey;
  }
  await commitChunk(deviceIp, job.file, job.start, mark, repo);
  if (job.file.gzip) finishKey(mark, job.file.fileKey);
  else {
    mark.floor = job.file.fileKey;
    mark.tail = { key: job.file.fileKey, offset: job.file.size, rawSize: job.file.size };
  }
  await repo.saveCheckpoint(deviceIp, LIVE_FILE_KEY, 0, mark);
  return true;
}

function finishKey(mark: LiveMark, fileKey: string): void {
  mark.floor = fileKey;
  mark.tail = null;
}

/** Read until the gateway is idle. Tests use this to walk a fixture to the end. */
export async function replayDevice(
  deviceIp: string,
  files: readonly TraceSource[],
  repo: TraceRepository,
): Promise<void> {
  for (let n = 0; n < files.length * 4 + 4; n += 1) {
    const moved = await stepDevice(deviceIp, files, repo);
    if (!moved) return;
  }
}

function seedMark(files: readonly TraceSource[]): LiveMark {
  const newest = [...files].sort((a, b) => a.fileKey.localeCompare(b.fileKey)).at(-1)!;
  const mark: LiveMark = {
    floor: newest.fileKey,
    tail: newest.gzip
      ? null
      : { key: newest.fileKey, offset: newest.size, rawSize: newest.size },
    slotIndex: 0,
    slotKey: newest.fileKey,
    state: emptyTraceState(),
  };
  return mark;
}

type Job =
  | { kind: "read"; file: TraceSource; start: number }
  | { kind: "close"; file: TraceSource };

function nextJob(files: readonly TraceSource[], mark: LiveMark): Job | null {
  const sorted = [...files].sort((a, b) => a.fileKey.localeCompare(b.fileKey));
  for (const file of sorted) {
    if (file.fileKey < mark.floor) continue;
    const tail = mark.tail;
    if (tail && file.fileKey === tail.key) {
      if (!file.gzip && file.size > tail.offset) return { kind: "read", file, start: tail.offset };
      if (file.gzip && tail.offset < tail.rawSize) return { kind: "read", file, start: tail.offset };
      if (file.gzip && tail.offset >= tail.rawSize) return { kind: "close", file };
      continue;
    }
    if (!tail && file.fileKey === mark.floor) continue;
    if (tail && file.fileKey < tail.key) continue;
    return { kind: "read", file, start: 0 };
  }
  return null;
}

async function commitChunk(
  deviceIp: string,
  file: TraceSource,
  start: number,
  mark: LiveMark,
  repo: TraceRepository,
): Promise<void> {
  const detached = await applySource(mark.state, file, start);
  let written = 0;
  for (const span of detached) written += await saveTagged(repo, deviceIp, span);
  for (const span of commitTraceFile(mark.state, mark.slotIndex, file.fileKey)) {
    written += await saveTagged(repo, deviceIp, span);
  }
  const open = Object.values(mark.state.spans).filter((span) => !span.ended).length;
  logger.info("smg.trace.file", {
    deviceIp,
    fileKey: file.fileKey,
    written,
    open,
  });
}

async function loadMark(repo: TraceRepository, deviceIp: string): Promise<LiveMark | null> {
  const raw = await repo.loadCheckpointState(deviceIp, LIVE_FILE_KEY);
  return parseMark(raw);
}

function parseMark(raw: unknown): LiveMark | null {
  const floor = readLiveFloor(raw);
  if (!floor || !raw || typeof raw !== "object") return null;
  const row = raw as Partial<LiveMark>;
  return {
    floor,
    tail: parseTail(row.tail),
    slotIndex: typeof row.slotIndex === "number" ? row.slotIndex : 0,
    slotKey: typeof row.slotKey === "string" ? row.slotKey : floor,
    state: restoreTraceState(row.state),
  };
}

function parseTail(value: unknown): Tail | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<Tail>;
  if (typeof row.key !== "string" || typeof row.offset !== "number" || typeof row.rawSize !== "number") {
    return null;
  }
  return { key: row.key, offset: row.offset, rawSize: row.rawSize };
}

async function saveTagged(
  repo: TraceRepository,
  deviceIp: string,
  span: TraceSpan,
): Promise<number> {
  if (!span.tag) return 0;
  await repo.saveSpan(deviceIp, span);
  return 1;
}

export async function applySource(
  state: TraceState,
  file: TraceSource,
  start = 0,
): Promise<TraceSpan[]> {
  const detached: TraceSpan[] = [];
  const input = openTraceInput(file, start);
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const gone = applyLine(state, line);
      if (gone?.tag) detached.push(gone);
    }
  } finally {
    lines.close();
  }
  return detached;
}

function openTraceInput(file: TraceSource, start: number): Readable {
  if (!file.gzip) {
    const input = createReadStream(file.abs, { start, end: Math.max(start, file.size - 1) });
    if (start > 0 && byteBefore(file.abs, start) !== 0x0a) return dropPartialLine(input);
    return input;
  }
  const fileStream = createReadStream(file.abs);
  const gunzip = createGunzip();
  fileStream.on("error", (error) => gunzip.destroy(error));
  fileStream.pipe(gunzip);
  if (start <= 0) return gunzip;
  return skipUncompressed(gunzip, start);
}

function byteBefore(abs: string, offset: number): number {
  const fd = openSync(abs, "r");
  try {
    const buf = Buffer.alloc(1);
    const n = readSync(fd, buf, 0, 1, offset - 1);
    return n === 1 ? (buf[0] ?? 0x0a) : 0x0a;
  } finally {
    closeSync(fd);
  }
}

function dropPartialLine(source: Readable): Readable {
  return skipUncompressed(source, 0, true);
}

function skipUncompressed(source: Readable, count: number, forceDrop = false): Readable {
  const out = new PassThrough();
  let skip = count;
  let last = 0x0a;
  let dropping = forceDrop;
  source.on("data", (chunk: Buffer) => {
    let rest = chunk;
    if (skip > 0) {
      if (rest.length <= skip) {
        last = rest[rest.length - 1] ?? last;
        skip -= rest.length;
        return;
      }
      last = rest[skip - 1] ?? last;
      rest = rest.subarray(skip);
      skip = 0;
      dropping = last !== 0x0a;
    }
    if (dropping) {
      const nl = rest.indexOf(0x0a);
      if (nl < 0) return;
      dropping = false;
      rest = rest.subarray(nl + 1);
    }
    if (rest.length > 0) out.write(rest);
  });
  source.on("end", () => out.end());
  source.on("error", (error) => out.destroy(error));
  return out;
}

function collectDevice(dir: string, ip: string, sources: TraceSource[]): void {
  for (const year of childNames(dir, YEAR)) {
    for (const month of childNames(path.join(dir, year), MONTH)) {
      for (const day of childNames(path.join(dir, year, month), DAY)) {
        for (const hour of childNames(path.join(dir, year, month, day), HOUR)) {
          pushHour(path.join(dir, year, month, day, hour), ip, year, month, day, hour, sources);
        }
      }
    }
  }
}

function collectSince(dir: string, ip: string, floor: string, sources: TraceSource[]): void {
  const min = floor.split("/").slice(1);
  const minYear = min[0] ?? "";
  const minMonth = min[1] ?? "";
  const minDay = min[2] ?? "";
  const minHour = min[3] ?? "";
  for (const year of childNames(dir, YEAR)) {
    if (year < minYear) continue;
    for (const month of childNames(path.join(dir, year), MONTH)) {
      if (year === minYear && month < minMonth) continue;
      for (const day of childNames(path.join(dir, year, month), DAY)) {
        if (year === minYear && month === minMonth && day < minDay) continue;
        for (const hour of childNames(path.join(dir, year, month, day), HOUR)) {
          if (year === minYear && month === minMonth && day === minDay && hour < minHour) continue;
          pushHour(path.join(dir, year, month, day, hour), ip, year, month, day, hour, sources);
        }
      }
    }
  }
}

function pushHour(
  hourDir: string,
  ip: string,
  year: string,
  month: string,
  day: string,
  hour: string,
  sources: TraceSource[],
): void {
  for (const slot of slotNames(hourDir)) {
    const picked = pickSlot(hourDir, slot);
    if (!picked) continue;
    sources.push({
      deviceIp: ip,
      fileKey: `${ip}/${year}/${month}/${day}/${hour}/${slot}`,
      abs: picked.abs,
      gzip: picked.gzip,
      size: picked.size,
    });
  }
}

function childNames(dir: string, pattern: RegExp): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && pattern.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function slotNames(dir: string): string[] {
  const found = new Set<string>();
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const match = entry.name.match(/^(00|10|20|30|40|50)\.log(?:\.gz)?$/);
      if (match?.[1]) found.add(match[1]);
    }
  } catch {
    return [];
  }
  return [...found].sort();
}

/** The raw log is the open bucket. A closed bucket is only the gzip. */
function pickSlot(dir: string, slot: string): { abs: string; gzip: boolean; size: number } | null {
  for (const [suffix, gzip] of [
    [".log", false],
    [".log.gz", true],
  ] as const) {
    const abs = path.join(dir, `${slot}${suffix}`);
    try {
      const stat = statSync(abs);
      if (!stat.isFile()) continue;
      return { abs, gzip, size: stat.size };
    } catch {
      /* the other form may exist */
    }
  }
  return null;
}
