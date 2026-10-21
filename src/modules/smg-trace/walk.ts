import { openSync, readdirSync, readFileSync, readSync, closeSync, statSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { logger } from "@/lib/logger";
import {
  applyLine,
  cloneTraceState,
  commitTraceFile,
  emptyTraceState,
  restoreTraceState,
  SMG_TRACE_PARSER_VERSION,
  spanOpensCard,
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
  /** Drop this gateway's cards. Used once, before a current-version mark exists. */
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
  /** CRC32 of raw bytes `[0, offset)`. Set when this file has no `fileStart` snapshot. */
  prefixCrc?: number;
};

type LiveMark = {
  /** Keys strictly older than this are ignored. */
  floor: string;
  /** Null once `floor` itself is finished and must not be opened. */
  tail: Tail | null;
  slotIndex: number;
  slotKey: string;
  state: TraceState;
  /** Assembler state from before the first byte of `fileStartKey`. */
  fileStart: TraceState | null;
  fileStartKey: string | null;
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
 * Drop every card when no gateway has a live mark of this parser version.
 * A later pass sees that mark and leaves cards in place. A gateway that
 * appears afterwards has no foreign mark, so its new cards stay.
 */
export async function forgetCardsIfUnmarked(repo: {
  liveMarkVersions(): Promise<readonly number[]>;
  deleteAllCards(): Promise<void>;
}): Promise<boolean> {
  const versions = await repo.liveMarkVersions();
  if (versions.some((version) => version === SMG_TRACE_PARSER_VERSION)) return false;
  await repo.deleteAllCards();
  return true;
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
    if (hasLive) {
      logger.warn("smg.trace.mark_unreadable", { deviceIp });
      return false;
    }
    if (files.length === 0) return false;
    mark = seedMark(files);
    await repo.saveCheckpoint(deviceIp, LIVE_FILE_KEY, 0, mark);
    return true;
  }
  const job = nextJob(files, mark);
  if (!job) return false;
  if (job.kind === "hold") {
    logger.info("smg.trace.slot_held", {
      deviceIp,
      fileKey: job.fileKey,
      waiting: job.waiting,
    });
    return false;
  }
  if (job.kind === "stuck") {
    logger.warn(job.reason === "gzip" ? "smg.trace.gzip_size_unknown" : "smg.trace.gzip_identity", {
      deviceIp,
      fileKey: job.file.fileKey,
    });
    return false;
  }
  if (job.kind === "missing") {
    logger.warn("smg.trace.slot_missing", { deviceIp, fileKey: job.fileKey });
    finishKey(mark, job.fileKey);
    await repo.saveCheckpoint(deviceIp, LIVE_FILE_KEY, 0, mark);
    return true;
  }
  if (job.kind === "close") {
    finishKey(mark, job.file.fileKey);
    await repo.saveCheckpoint(deviceIp, LIVE_FILE_KEY, 0, mark);
    return true;
  }
  if (job.kind === "begin" || job.kind === "begin-gzip") {
    if (job.file.fileKey !== mark.slotKey) {
      mark.slotIndex += 1;
      mark.slotKey = job.file.fileKey;
    }
    mark.fileStart = cloneTraceState(mark.state);
    mark.fileStartKey = job.file.fileKey;
  }
  if (job.kind === "replay") {
    if (!mark.fileStart) {
      logger.warn("smg.trace.gzip_identity", { deviceIp, fileKey: job.file.fileKey });
      return false;
    }
    mark.state = cloneTraceState(mark.fileStart);
  }

  const read =
    job.kind === "replay" || job.kind === "begin-gzip"
      ? readWholeGzip(mark.state, job.file)
      : job.kind === "suffix"
        ? readGzipSuffix(mark.state, job.file, mark.tail)
        : readRaw(mark.state, job.file, job.start);
  if (!read.ok) {
    logger.warn(read.reason === "identity" ? "smg.trace.gzip_identity" : "smg.trace.gzip_size_unknown", {
      deviceIp,
      fileKey: job.file.fileKey,
    });
    return false;
  }
  if (read.torn) logger.warn("smg.trace.torn_frozen", { deviceIp, fileKey: job.file.fileKey });
  if (job.kind === "append" && read.consumed === 0) return false;

  await commitChunk(deviceIp, job.file, mark, read.detached, repo);
  if (job.kind === "replay" || job.kind === "begin-gzip" || job.kind === "suffix") {
    finishKey(mark, job.file.fileKey);
  } else {
    const offset = job.start + read.consumed;
    mark.floor = job.file.fileKey;
    mark.tail = {
      key: job.file.fileKey,
      offset,
      rawSize: job.file.size,
      prefixCrc: mark.fileStartKey === job.file.fileKey ? undefined : checksum(readRawSlice(job.file.abs, 0, offset)),
    };
  }
  await repo.saveCheckpoint(deviceIp, LIVE_FILE_KEY, 0, mark);
  return true;
}

function finishKey(mark: LiveMark, fileKey: string): void {
  mark.floor = fileKey;
  mark.tail = null;
  if (mark.fileStartKey === fileKey) {
    mark.fileStart = null;
    mark.fileStartKey = null;
  }
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
    tail: null,
    slotIndex: 0,
    slotKey: newest.fileKey,
    state: emptyTraceState(),
    fileStart: null,
    fileStartKey: null,
  };
  if (!newest.gzip) {
    const raw = readRawSlice(newest.abs, 0, newest.size);
    const cut = completeCut(raw, false);
    mark.tail = {
      key: newest.fileKey,
      offset: cut.consumed,
      rawSize: newest.size,
      prefixCrc: checksum(raw.subarray(0, cut.consumed)),
    };
  }
  return mark;
}

type Job =
  | { kind: "begin"; file: TraceSource; start: 0 }
  | { kind: "begin-gzip"; file: TraceSource }
  | { kind: "append"; file: TraceSource; start: number }
  | { kind: "replay"; file: TraceSource }
  | { kind: "suffix"; file: TraceSource }
  | { kind: "close"; file: TraceSource }
  | { kind: "hold"; fileKey: string; waiting: string }
  | { kind: "stuck"; file: TraceSource; reason: "identity" | "gzip" }
  | { kind: "missing"; fileKey: string };

function nextJob(files: readonly TraceSource[], mark: LiveMark): Job | null {
  const sorted = [...files].sort((a, b) => a.fileKey.localeCompare(b.fileKey));
  const tail = mark.tail;
  if (tail && !sorted.some((file) => file.fileKey === tail.key)) {
    return { kind: "missing", fileKey: tail.key };
  }
  for (const file of sorted) {
    if (file.fileKey < mark.floor) continue;
    if (tail && file.fileKey === tail.key) {
      if (!file.gzip) {
        if (file.size > tail.offset) return { kind: "append", file, start: tail.offset };
        const waiting = sorted.find((item) => item.fileKey > file.fileKey);
        if (waiting) return { kind: "hold", fileKey: file.fileKey, waiting: waiting.fileKey };
        return null;
      }
      if (mark.fileStart && mark.fileStartKey === file.fileKey) return { kind: "replay", file };
      if (typeof tail.prefixCrc === "number") return { kind: "suffix", file };
      return { kind: "stuck", file, reason: "identity" };
    }
    if (!tail && file.fileKey === mark.floor) continue;
    if (tail && file.fileKey < tail.key) continue;
    if (tail) {
      const waiting = sorted.find((item) => item.fileKey > tail.key);
      if (waiting) return { kind: "hold", fileKey: tail.key, waiting: waiting.fileKey };
      return null;
    }
    return file.gzip ? { kind: "begin-gzip", file } : { kind: "begin", file, start: 0 };
  }
  return null;
}

async function commitChunk(
  deviceIp: string,
  file: TraceSource,
  mark: LiveMark,
  detached: readonly TraceSpan[],
  repo: TraceRepository,
): Promise<void> {
  let written = 0;
  for (const span of detached) {
    if (!span.startedKey) span.startedKey = file.fileKey;
    written += await saveTagged(repo, deviceIp, span);
  }
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
    fileStart: row.fileStart ? restoreTraceState(row.fileStart) : null,
    fileStartKey: typeof row.fileStartKey === "string" ? row.fileStartKey : null,
  };
}

function parseTail(value: unknown): Tail | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<Tail>;
  if (typeof row.key !== "string" || typeof row.offset !== "number" || typeof row.rawSize !== "number") {
    return null;
  }
  return {
    key: row.key,
    offset: row.offset,
    rawSize: row.rawSize,
    prefixCrc: typeof row.prefixCrc === "number" ? row.prefixCrc : undefined,
  };
}

async function saveTagged(
  repo: TraceRepository,
  deviceIp: string,
  span: TraceSpan,
): Promise<number> {
  if (!spanOpensCard(span)) return 0;
  await repo.saveSpan(deviceIp, span);
  return 1;
}

type ReadResult = {
  ok: boolean;
  consumed: number;
  detached: TraceSpan[];
  torn: boolean;
  reason: "identity" | "gzip";
};

function readRaw(state: TraceState, file: TraceSource, start: number): ReadResult {
  const slice = readRawSlice(file.abs, start, file.size);
  const cut = completeCut(slice, false);
  return { ok: true, consumed: cut.consumed, detached: applyTextBytes(state, cut.text), torn: false, reason: "gzip" };
}

function readWholeGzip(state: TraceState, file: TraceSource): ReadResult {
  const plain = inflateGzip(file.abs);
  if (!plain) return { ok: false, consumed: 0, detached: [], torn: false, reason: "gzip" };
  const cut = completeCut(plain, true);
  return {
    ok: true,
    consumed: cut.consumed,
    detached: applyTextBytes(state, cut.text),
    torn: cut.torn,
    reason: "gzip",
  };
}

function readGzipSuffix(state: TraceState, file: TraceSource, tail: Tail | null): ReadResult {
  const plain = inflateGzip(file.abs);
  if (!plain || !tail || typeof tail.prefixCrc !== "number") {
    return { ok: false, consumed: 0, detached: [], torn: false, reason: "gzip" };
  }
  if (plain.length < tail.offset || checksum(plain.subarray(0, tail.offset)) !== tail.prefixCrc) {
    return { ok: false, consumed: 0, detached: [], torn: false, reason: "identity" };
  }
  const cut = completeCut(plain.subarray(tail.offset), true);
  return {
    ok: true,
    consumed: cut.consumed,
    detached: applyTextBytes(state, cut.text),
    torn: cut.torn,
    reason: "gzip",
  };
}

function inflateGzip(abs: string): Buffer | null {
  try {
    const gzip = readFileSync(abs);
    if (gzip.length < 8) return null;
    return gunzipSync(gzip);
  } catch {
    return null;
  }
}

function readRawSlice(abs: string, start: number, end: number): Buffer {
  const length = Math.max(0, end - start);
  if (length === 0) return Buffer.alloc(0);
  const buf = Buffer.alloc(length);
  const fd = openSync(abs, "r");
  try {
    let got = 0;
    while (got < length) {
      const n = readSync(fd, buf, got, length - got, start + got);
      if (n <= 0) break;
      got += n;
    }
    return buf.subarray(0, got);
  } finally {
    closeSync(fd);
  }
}

function completeCut(buf: Buffer, feedTorn: boolean): { text: string; consumed: number; torn: boolean } {
  if (buf.length === 0) return { text: "", consumed: 0, torn: false };
  if (buf[buf.length - 1] === 0x0a) return { text: buf.toString("utf8"), consumed: buf.length, torn: false };
  const last = buf.lastIndexOf(0x0a);
  if (last >= 0) {
    return { text: buf.subarray(0, last + 1).toString("utf8"), consumed: last + 1, torn: false };
  }
  if (!feedTorn) return { text: "", consumed: 0, torn: false };
  return { text: `${buf.toString("utf8")}\n`, consumed: buf.length, torn: true };
}

function applyTextBytes(state: TraceState, text: string): TraceSpan[] {
  const detached: TraceSpan[] = [];
  if (!text) return detached;
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  for (const line of lines) {
    const gone = applyLine(state, line);
    if (gone?.tag) detached.push(gone);
  }
  return detached;
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function checksum(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
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
