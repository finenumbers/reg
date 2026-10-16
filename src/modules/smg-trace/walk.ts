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

export type TraceCheckpoint = {
  fileKey: string;
  size: number;
  version: number;
  state: unknown;
};

export type TraceRepository = {
  loadCheckpoints(deviceIp: string): Promise<TraceCheckpoint[]>;
  resetDevice(deviceIp: string): Promise<void>;
  saveSpan(deviceIp: string, span: TraceSpan): Promise<void>;
  saveCheckpoint(
    deviceIp: string,
    fileKey: string,
    size: number,
    state: TraceState,
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
 * Read files in order. A changed file is read again from the checkpoint before it,
 * and every later file of that gateway is read again too.
 */
export async function replayDevice(
  deviceIp: string,
  files: readonly TraceSource[],
  repo: TraceRepository,
): Promise<void> {
  const saved = await repo.loadCheckpoints(deviceIp);
  if (saved.some((row) => row.version !== SMG_TRACE_PARSER_VERSION)) {
    await repo.resetDevice(deviceIp);
  }
  const checkpoints = saved.filter((row) => row.version === SMG_TRACE_PARSER_VERSION);
  const byKey = new Map(checkpoints.map((row) => [row.fileKey, row]));

  let start = files.length;
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]!;
    const checkpoint = byKey.get(file.fileKey);
    if (!checkpoint || checkpoint.size !== file.size) {
      start = i;
      break;
    }
  }
  if (start >= files.length) return;

  let state = emptyTraceState();
  if (start > 0) {
    const previous = byKey.get(files[start - 1]!.fileKey);
    if (previous) state = restoreTraceState(previous.state);
  }

  for (let i = start; i < files.length; i += 1) {
    const file = files[i]!;
    const detached = await applySource(state, file);
    let written = 0;
    for (const span of detached) written += await saveTagged(repo, deviceIp, span);
    for (const span of commitTraceFile(state, i)) written += await saveTagged(repo, deviceIp, span);
    const open = Object.values(state.spans).filter((span) => !span.echoed).length;
    logger.info("smg.trace.file", {
      deviceIp,
      fileKey: file.fileKey,
      written,
      open,
    });
    await repo.saveCheckpoint(deviceIp, file.fileKey, file.size, state);
  }
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
