import { createReadStream, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
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
  /** Drop assembler marks that are not the current one. Cards stay. */
  deleteStaleCheckpoints(deviceIp: string): Promise<void>;
  clearCheckpointState(deviceIp: string, fileKey: string): Promise<void>;
  saveSpan(deviceIp: string, span: TraceSpan): Promise<void>;
  saveCheckpoint(
    deviceIp: string,
    fileKey: string,
    size: number,
    state: unknown,
  ): Promise<void>;
};

/** Closed gzip buckets and the still-open raw log, oldest first. */
export function listTraceSources(root: string): TraceSource[] {
  const sources: TraceSource[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  for (const name of names) {
    const ip = canonicalIpv4(name);
    if (!ip || looksLikeDockerBridge(ip)) continue;
    collectDevice(path.join(root, name), ip, sources);
  }
  sources.sort((a, b) => a.fileKey.localeCompare(b.fileKey));
  return sources;
}

/**
 * One file for this gateway. Current-day files that the archive has not
 * reached are written first. The archive then continues from the oldest
 * file that has no current mark. Returns false when there is nothing to read.
 */
export async function stepDevice(
  deviceIp: string,
  files: readonly TraceSource[],
  repo: TraceRepository,
): Promise<boolean> {
  if (files.length === 0) return false;
  const saved = await repo.loadCheckpointMeta(deviceIp);
  if (saved.some((row) => !isLiveFileKey(row.fileKey) && row.version !== SMG_TRACE_PARSER_VERSION)) {
    await repo.deleteStaleCheckpoints(deviceIp);
  }
  const meta = (await repo.loadCheckpointMeta(deviceIp)).filter(
    (row) => row.version === SMG_TRACE_PARSER_VERSION && !isLiveFileKey(row.fileKey),
  );
  const byKey = new Map(meta.map((row) => [row.fileKey, row]));
  const day = dayOf(files[files.length - 1]!);
  const dayFiles = files.filter((file) => dayOf(file) === day);
  const live = await loadLive(repo, deviceIp, day);
  const liveFile = nextLiveFile(dayFiles, live, byKey);
  if (liveFile) {
    await readLiveFile(deviceIp, liveFile, dayFiles, live, repo);
    return true;
  }
  const archiveAt = firstUnmarked(files, byKey);
  if (archiveAt < files.length) {
    await readArchiveFile(deviceIp, files, archiveAt, repo);
    return true;
  }
  const refresh = grownOpenFile(dayFiles, live, byKey);
  if (refresh) {
    await readLiveFile(deviceIp, refresh, dayFiles, live, repo);
    return true;
  }
  return false;
}

/** Read every gateway once. Tests use this to walk a fixture to the end. */
export async function replayDevice(
  deviceIp: string,
  files: readonly TraceSource[],
  repo: TraceRepository,
): Promise<void> {
  for (let n = 0; n < files.length * 3 + 2; n += 1) {
    const moved = await stepDevice(deviceIp, files, repo);
    if (!moved) return;
  }
}

type LiveCursor = {
  day: string;
  state: TraceState;
  sizes: Record<string, number>;
};

async function loadLive(
  repo: TraceRepository,
  deviceIp: string,
  day: string,
): Promise<LiveCursor> {
  const raw = await repo.loadCheckpointState(deviceIp, LIVE_FILE_KEY);
  if (!raw || typeof raw !== "object") return { day, state: emptyTraceState(), sizes: {} };
  const row = raw as { day?: unknown; state?: unknown; sizes?: unknown };
  if (row.day !== day) return { day, state: emptyTraceState(), sizes: {} };
  const sizes: Record<string, number> = {};
  if (row.sizes && typeof row.sizes === "object") {
    for (const [key, value] of Object.entries(row.sizes)) {
      if (typeof value === "number") sizes[key] = value;
    }
  }
  return { day, state: restoreTraceState(row.state), sizes };
}

function nextLiveFile(
  dayFiles: readonly TraceSource[],
  live: LiveCursor,
  archived: ReadonlyMap<string, TraceCheckpointMeta>,
): TraceSource | null {
  for (const file of dayFiles) {
    if (archived.has(file.fileKey)) continue;
    if (live.sizes[file.fileKey] === file.size) continue;
    if (!file.gzip && live.sizes[file.fileKey] != null) continue;
    return file;
  }
  return null;
}

function grownOpenFile(
  dayFiles: readonly TraceSource[],
  live: LiveCursor,
  archived: ReadonlyMap<string, TraceCheckpointMeta>,
): TraceSource | null {
  const last = dayFiles[dayFiles.length - 1];
  if (!last || last.gzip || archived.has(last.fileKey)) return null;
  if (live.sizes[last.fileKey] == null || live.sizes[last.fileKey] === last.size) return null;
  return last;
}

async function readLiveFile(
  deviceIp: string,
  file: TraceSource,
  dayFiles: readonly TraceSource[],
  live: LiveCursor,
  repo: TraceRepository,
): Promise<void> {
  const index = Math.max(0, dayFiles.findIndex((item) => item.fileKey === file.fileKey));
  const lastKey = dayFiles[dayFiles.length - 1]?.fileKey;
  const fold = file.gzip || file.fileKey !== lastKey;
  const base = fold ? live.state : cloneState(live.state);
  await commitFile(deviceIp, file, base, index, repo);
  if (fold) live.state = base;
  live.sizes[file.fileKey] = file.size;
  await repo.saveCheckpoint(deviceIp, LIVE_FILE_KEY, 0, live);
}

async function readArchiveFile(
  deviceIp: string,
  files: readonly TraceSource[],
  index: number,
  repo: TraceRepository,
): Promise<void> {
  const file = files[index]!;
  let state = emptyTraceState();
  if (index > 0) {
    const previous = await repo.loadCheckpointState(deviceIp, files[index - 1]!.fileKey);
    if (previous) state = restoreTraceState(previous);
  }
  await commitFile(deviceIp, file, state, index, repo);
  await repo.saveCheckpoint(deviceIp, file.fileKey, file.size, state);
  if (index > 0) await repo.clearCheckpointState(deviceIp, files[index - 1]!.fileKey);
}

async function commitFile(
  deviceIp: string,
  file: TraceSource,
  state: TraceState,
  index: number,
  repo: TraceRepository,
): Promise<void> {
  const detached = await applySource(state, file);
  let written = 0;
  for (const span of detached) written += await saveTagged(repo, deviceIp, span);
  for (const span of commitTraceFile(state, index)) written += await saveTagged(repo, deviceIp, span);
  const open = Object.values(state.spans).filter((span) => !span.echoed).length;
  logger.info("smg.trace.file", {
    deviceIp,
    fileKey: file.fileKey,
    written,
    open,
  });
}

function firstUnmarked(
  files: readonly TraceSource[],
  archived: ReadonlyMap<string, TraceCheckpointMeta>,
): number {
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]!;
    const checkpoint = archived.get(file.fileKey);
    if (!checkpoint || checkpoint.size !== file.size) return i;
  }
  return files.length;
}

function dayOf(file: TraceSource): string {
  const parts = file.fileKey.split("/");
  return `${parts[1]}/${parts[2]}/${parts[3]}`;
}

function cloneState(state: TraceState): TraceState {
  return restoreTraceState(JSON.parse(JSON.stringify(state)) as unknown);
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

export async function applySource(state: TraceState, file: TraceSource): Promise<TraceSpan[]> {
  const detached: TraceSpan[] = [];
  const input = createReadStream(file.abs);
  const source = file.gzip ? input.pipe(createGunzip()) : input;
  const lines = createInterface({ input: source, crlfDelay: Infinity });
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

function collectDevice(dir: string, ip: string, sources: TraceSource[]): void {
  for (const year of childNames(dir, YEAR)) {
    for (const month of childNames(path.join(dir, year), MONTH)) {
      for (const day of childNames(path.join(dir, year, month), DAY)) {
          for (const hour of childNames(path.join(dir, year, month, day), HOUR)) {
            const hourDir = path.join(dir, year, month, day, hour);
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
      }
    }
  }
}

function childNames(dir: string, pattern: RegExp): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
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
      if (!entry.isFile()) continue;
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
