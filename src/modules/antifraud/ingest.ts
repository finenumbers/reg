import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { isDatabaseVacuumActive } from "@/modules/storage/vacuum/gate";
import { TICK_BUDGET_BYTES } from "@/modules/antifraud/constants";
import {
  foldFileSwitch,
  planFileChange,
  planTickStamp,
  parseStat,
  takeCompleteRecords,
  type IngestCursor,
  type StatSnapshot,
  type TickMemory,
  type TickStamp,
} from "@/modules/antifraud/cursor";
import { parseDetailBlock } from "@/modules/antifraud/parse";
import { loadParkingPrivateKeyPem, loadParkingTarget } from "@/modules/antifraud/secret";
import {
  readCallsChunk,
  readCallsStat,
  withParkingConnection,
  ParkingSshError,
  type RemoteRead,
} from "@/modules/antifraud/ssh-read";
import type { ParkingTarget } from "@/modules/antifraud/target";

const LOCK_KEY = "__reg_parking_ingest__";

type Lock = { running: boolean };

function lock(): Lock {
  const g = globalThis as typeof globalThis & { [LOCK_KEY]?: Lock };
  if (!g[LOCK_KEY]) g[LOCK_KEY] = { running: false };
  return g[LOCK_KEY];
}

function asBuffer(value: Uint8Array | Buffer | null | undefined): Buffer {
  if (!value || value.length === 0) return Buffer.alloc(0);
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

/** Copy into a standalone ArrayBuffer. Prisma Bytes rejects a shared buffer. */
function bytesField(value: Buffer): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}

function cursorFrom(row: {
  generation: number;
  inode: string;
  byteOffset: bigint;
  fileSize: bigint;
  pending: Uint8Array;
}): IngestCursor {
  return {
    generation: row.generation,
    inode: row.inode,
    byteOffset: row.byteOffset,
    fileSize: row.fileSize,
    pending: asBuffer(row.pending),
  };
}

async function ensureState() {
  return prisma.radiusIngestState.upsert({
    where: { id: 1 },
    create: { id: 1, pending: Buffer.alloc(0) },
    update: {},
  });
}

async function setError(message: string): Promise<void> {
  const text = message.slice(0, 500);
  await prisma.radiusIngestState.upsert({
    where: { id: 1 },
    create: { id: 1, pending: Buffer.alloc(0), lastError: text },
    update: { lastError: text },
  });
}

function rowFrom(slice: { fileOffset: bigint; bytes: Buffer }, generation: number) {
  const parsed = parseDetailBlock(slice.bytes);
  return {
    generation,
    byteOffset: slice.fileOffset,
    loggedAt: parsed.loggedAt,
    headerRaw: parsed.headerRaw,
    packetType: parsed.packetType,
    callOrigin: parsed.callOrigin,
    userName: parsed.userName,
    callingStationId: parsed.callingStationId,
    calledStationId: parsed.calledStationId,
    srcNumberOut: parsed.srcNumberOut,
    dstNumberOut: parsed.dstNumberOut,
    inTrunk: parsed.inTrunk,
    outTrunk: parsed.outTrunk,
    remoteId: parsed.remoteId,
    srcIp: parsed.srcIp,
    acctSessionId: parsed.acctSessionId,
    attrs: parsed.attrs,
    raw: bytesField(slice.bytes),
  };
}

async function applyReset(
  state: IngestCursor,
  stat: StatSnapshot,
  change: Extract<ReturnType<typeof planFileChange>, { kind: "reset" }>,
  sourcePath?: string,
): Promise<void> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (
      change.flushPending.length > 0 &&
      change.flushOffset != null &&
      change.flushOffset >= BigInt(0)
    ) {
      await tx.radiusCall.createMany({
        data: [
          rowFrom(
            { fileOffset: change.flushOffset, bytes: change.flushPending },
            state.generation,
          ),
        ],
        skipDuplicates: true,
      });
    }
    if (change.gap && change.gap.toOffset > change.gap.fromOffset) {
      await tx.radiusIngestGap.create({
        data: {
          generation: state.generation,
          fromOffset: change.gap.fromOffset,
          toOffset: change.gap.toOffset,
          reason: change.reason,
        },
      });
    }
    await tx.radiusIngestState.update({
      where: { id: 1 },
      data: {
        generation: state.generation + 1,
        inode: stat.inode,
        byteOffset: BigInt(0),
        fileSize: stat.size,
        pending: Buffer.alloc(0),
        lastError: null,
        lastSuccessAt: now,
        ...(sourcePath ? { sourcePath } : {}),
      },
    });
  });
  logger.info("parking.ingest.reset", {
    reason: change.reason,
    generation: state.generation + 1,
    gapFrom: change.gap?.fromOffset.toString() ?? null,
    gapTo: change.gap?.toOffset.toString() ?? null,
  });
}

async function applyTruncateTail(
  state: IngestCursor,
  stat: StatSnapshot,
  gap: { fromOffset: bigint; toOffset: bigint },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (gap.toOffset > gap.fromOffset) {
      await tx.radiusIngestGap.create({
        data: {
          generation: state.generation,
          fromOffset: gap.fromOffset,
          toOffset: gap.toOffset,
          reason: "file_shrunk",
        },
      });
    }
    await tx.radiusIngestState.update({
      where: { id: 1 },
      data: { fileSize: stat.size, inode: stat.inode, lastError: null },
    });
  });
}

async function commitChunk(
  state: IngestCursor,
  stat: StatSnapshot,
  taken: ReturnType<typeof takeCompleteRecords>,
): Promise<void> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (taken.records.length > 0) {
      await tx.radiusCall.createMany({
        data: taken.records.map((slice) => rowFrom(slice, state.generation)),
        skipDuplicates: true,
      });
    }
    await tx.radiusIngestState.update({
      where: { id: 1 },
      data: {
        inode: stat.inode,
        byteOffset: taken.nextOffset,
        fileSize: stat.size,
        pending: bytesField(taken.pending),
        lastSuccessAt: now,
        lastError: null,
      },
    });
  });
}

async function markCaughtUp(stat: StatSnapshot): Promise<void> {
  const now = new Date();
  await prisma.radiusIngestState.update({
    where: { id: 1 },
    data: {
      inode: stat.inode,
      fileSize: stat.size,
      lastSuccessAt: now,
      lastError: null,
    },
  });
}

function cursorIsEmpty(state: IngestCursor): boolean {
  return (
    state.inode === "" && state.byteOffset === BigInt(0) && state.pending.length === 0
  );
}

async function adoptSource(logPath: string, stat: StatSnapshot): Promise<void> {
  await prisma.radiusIngestState.update({
    where: { id: 1 },
    data: {
      sourcePath: logPath,
      inode: stat.inode,
      fileSize: stat.size,
      lastError: null,
    },
  });
}

async function applyTickStamp(stamp: TickStamp): Promise<void> {
  if (stamp.kind === "none") return;
  const now = new Date();
  if (stamp.kind === "data") {
    await prisma.radiusIngestState.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        pending: Buffer.alloc(0),
        lastDataAt: now,
        lastDataHadRows: stamp.hadRows,
        lastSuccessAt: now,
      },
      update: {
        lastDataAt: now,
        lastDataHadRows: stamp.hadRows,
        lastSuccessAt: now,
        ...(stamp.clearError ? { lastError: null } : {}),
      },
    });
    return;
  }
  await prisma.radiusIngestState.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      pending: Buffer.alloc(0),
      lastCheckedAt: now,
      lastSuccessAt: now,
      lastError: null,
    },
    update: { lastCheckedAt: now, lastSuccessAt: now, lastError: null },
  });
}

type Exec = (command: string) => Promise<RemoteRead>;

async function readOnConnection(
  exec: Exec,
  connected: ParkingTarget,
  memory: TickMemory,
  budget: { left: number },
): Promise<"success" | "break" | "reconnect"> {
  while (budget.left > 0) {
    const fresh = await loadParkingTarget();
    if (fresh.host !== connected.host || fresh.username !== connected.username) {
      return "reconnect";
    }
    const row = await ensureState();
    const state = cursorFrom(row);
    if (row.sourcePath !== fresh.logPath) {
      const statRead = await readCallsStat(exec, fresh.logPath);
      const stat = parseStat(statRead.stdout.toString("utf8"));
      if (!stat) {
        await setError("Неожиданный ответ stat");
        return "break";
      }
      if (cursorIsEmpty(state) || (state.inode !== "" && state.inode === stat.inode)) {
        await adoptSource(fresh.logPath, stat);
      } else {
        foldFileSwitch(memory);
        const flushPending = state.pending.length > 0 ? state.pending : Buffer.alloc(0);
        await applyReset(
          state,
          stat,
          {
            kind: "reset",
            reason: "source_changed",
            gap:
              state.fileSize > state.byteOffset
                ? { fromOffset: state.byteOffset, toOffset: state.fileSize }
                : null,
            flushPending,
            flushOffset:
              flushPending.length > 0
                ? state.byteOffset - BigInt(flushPending.length)
                : null,
          },
          fresh.logPath,
        );
      }
      continue;
    }
    const statRead = await readCallsStat(exec, fresh.logPath);
    const stat = parseStat(statRead.stdout.toString("utf8"));
    if (!stat) {
      await setError("Неожиданный ответ stat");
      return "break";
    }
    const change = planFileChange(state, stat);
    if (change.kind === "reset") {
      foldFileSwitch(memory);
      await applyReset(state, stat, change);
      continue;
    }
    if (change.kind === "truncate-tail") {
      await applyTruncateTail(state, stat, change.gap);
      continue;
    }
    if (stat.size <= state.byteOffset) {
      await markCaughtUp(stat);
      return "success";
    }
    const chunk = await readCallsChunk(exec, state.byteOffset, fresh.logPath);
    if (chunk.stdout.length === 0) {
      await setError("Пустое чтение до конца файла");
      return "break";
    }
    const taken = takeCompleteRecords(state.pending, chunk.stdout, state.byteOffset);
    memory.bytes += chunk.stdout.length;
    memory.rows = memory.rows || taken.records.length > 0;
    await commitChunk(state, stat, taken);
    budget.left -= chunk.stdout.length;
    logger.info("parking.ingest.chunk", {
      generation: state.generation,
      rows: taken.records.length,
      bytes: chunk.stdout.length,
      offset: taken.nextOffset.toString(),
    });
  }
  return "success";
}

async function readTarget(memory: TickMemory): Promise<"success" | "break"> {
  const budget = { left: TICK_BUDGET_BYTES };
  while (true) {
    const pem = await loadParkingPrivateKeyPem();
    if (!pem) return "break";
    const target = await loadParkingTarget();
    const result = await withParkingConnection(
      { host: target.host, username: target.username, privateKeyPem: pem },
      (exec) => readOnConnection(exec, target, memory, budget),
    );
    if (result !== "reconnect") return result;
  }
}

/**
 * Read calls.log from the stored byte through the current end of file.
 * A tick stops after 64 MiB; the next tick continues at the next unread byte.
 */
export async function drainParkingCalls(): Promise<void> {
  const gate = lock();
  if (gate.running || isDatabaseVacuumActive()) return;
  gate.running = true;
  const memory: TickMemory = { priorBytes: 0, priorRows: false, bytes: 0, rows: false };
  let outcome: "success" | "break" | "skip" = "skip";
  try {
    const pem = await loadParkingPrivateKeyPem();
    if (!pem) return;
    outcome = await readTarget(memory);
  } catch (error) {
    outcome = "break";
    const message =
      error instanceof ParkingSshError ? error.message : "Не удалось прочитать calls.log";
    logger.warn("parking.ingest.failed", { error: message });
    try {
      await setError(message);
    } catch (writeError) {
      logger.warn("parking.ingest.error_write_failed", {
        error: writeError instanceof Error ? writeError.message : "write failed",
      });
    }
  } finally {
    try {
      if (outcome !== "skip") {
        await applyTickStamp(
          planTickStamp(memory, outcome === "success" ? "success" : "break"),
        );
      }
    } catch (stampError) {
      logger.warn("parking.ingest.stamp_failed", {
        error: stampError instanceof Error ? stampError.message : "stamp failed",
      });
    }
    gate.running = false;
  }
}
