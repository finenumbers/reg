export type RecordSlice = {
  fileOffset: bigint;
  bytes: Buffer;
};

export type TakenRecords = {
  records: RecordSlice[];
  pending: Buffer;
  nextOffset: bigint;
};

/**
 * Split a byte stream on the detail separator `\n\n`.
 * `fileOffset` is the next unread file position (after the previous pending).
 * The returned pending is stored, and the next read starts at nextOffset.
 */
export function takeCompleteRecords(
  pending: Buffer,
  incoming: Buffer,
  fileOffset: bigint,
): TakenRecords {
  const combined = Buffer.concat([pending, incoming]);
  const base = fileOffset - BigInt(pending.length);
  const records: RecordSlice[] = [];
  let start = 0;
  const separator = Buffer.from("\n\n");
  while (start < combined.length) {
    const rel = combined.subarray(start).indexOf(separator);
    if (rel < 0) break;
    const end = start + rel + separator.length;
    records.push({
      fileOffset: base + BigInt(start),
      bytes: Buffer.from(combined.subarray(start, end)),
    });
    start = end;
  }
  return {
    records,
    pending: Buffer.from(combined.subarray(start)),
    nextOffset: fileOffset + BigInt(incoming.length),
  };
}

export type IngestCursor = {
  generation: number;
  inode: string;
  byteOffset: bigint;
  fileSize: bigint;
  pending: Buffer;
};

export type StatSnapshot = {
  size: bigint;
  inode: string;
};

export type FileChange =
  | { kind: "continue" }
  | {
      kind: "truncate-tail";
      gap: { fromOffset: bigint; toOffset: bigint };
    }
  | {
      kind: "reset";
      reason: string;
      gap: { fromOffset: bigint; toOffset: bigint } | null;
      flushPending: Buffer;
      flushOffset: bigint | null;
    };

/**
 * Detect a replaced or shortened calls.log.
 * Unread bytes become a gap. An unfinished pending block is flushed, not dropped.
 */
export function planFileChange(state: IngestCursor, stat: StatSnapshot): FileChange {
  const known = state.inode !== "";
  const inodeChanged = known && state.inode !== stat.inode;
  const rewound = stat.size < state.byteOffset;
  if (inodeChanged || rewound) {
    const gap =
      state.fileSize > state.byteOffset
        ? { fromOffset: state.byteOffset, toOffset: state.fileSize }
        : null;
    const flushPending = state.pending.length > 0 ? state.pending : Buffer.alloc(0);
    const flushOffset =
      flushPending.length > 0 ? state.byteOffset - BigInt(flushPending.length) : null;
    return {
      kind: "reset",
      reason: inodeChanged ? "inode_changed" : "file_shrunk",
      gap,
      flushPending,
      flushOffset,
    };
  }
  if (known && state.fileSize > stat.size && stat.size >= state.byteOffset) {
    return {
      kind: "truncate-tail",
      gap: { fromOffset: stat.size, toOffset: state.fileSize },
    };
  }
  return { kind: "continue" };
}

/**
 * A look that finds no new bytes turns the load clock red.
 * Bytes stored earlier in the same tick are still a load, so that look does not.
 */
export function idleCheckMovesClock(bytesRead: number): boolean {
  return bytesRead === 0;
}

export type TickMemory = {
  priorBytes: number;
  priorRows: boolean;
  bytes: number;
  rows: boolean;
};

export type TickStamp =
  | { kind: "data"; hadRows: boolean; clearError: boolean }
  | { kind: "idle" }
  | { kind: "none" };

/**
 * One clock write for a finished tick.
 * Bytes already read before a file switch live in `priorBytes`.
 * A break before the first stored byte writes nothing.
 */
export function planTickStamp(
  memory: TickMemory,
  outcome: "success" | "break",
): TickStamp {
  const bytes = memory.priorBytes + memory.bytes;
  const rows = memory.priorRows || memory.rows;
  if (bytes > 0)
    return { kind: "data", hadRows: rows, clearError: outcome === "success" };
  if (outcome === "success") return { kind: "idle" };
  return { kind: "none" };
}

export function foldFileSwitch(memory: TickMemory): void {
  memory.priorBytes += memory.bytes;
  memory.priorRows = memory.priorRows || memory.rows;
  memory.bytes = 0;
  memory.rows = false;
}

/** `stat -c %s:%i` stdout. Anything else is refused so the cursor stays put. */
export function parseStat(stdout: string): StatSnapshot | null {
  const line = stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
  const match = /^(\d+):(\d+)$/.exec(line);
  if (!match?.[1] || !match[2]) return null;
  return { size: BigInt(match[1]), inode: match[2] };
}
