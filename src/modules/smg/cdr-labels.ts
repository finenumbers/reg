import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { AF_LABEL_REVISION } from "@/modules/smg-trace/label-pass";
import { classifyAntifraud } from "@/modules/smg-trace/classify";
import { realTag } from "@/modules/smg-trace/tag";
import type { TraceBlocks } from "@/modules/smg-trace/types";
import { NO_TRACE_LABELS, resolveStoredTraces } from "@/modules/smg/row-tokens";
import { smgMonthTimeRange } from "@/modules/smg/month-range";
import type { CdrMonth } from "@/modules/traffic/cdr-month";
import { isDatabaseVacuumActive } from "@/modules/storage/vacuum/gate";

/** Checkpoint that gates the fast antifraud filter. Not a syslog file. */
export const CDR_LABEL_DEVICE = "@cdr-labels";
export const CDR_LABEL_FILE_KEY = "@revision";

const NULL_BATCH = 20;
const SWEEP_BATCH = 40;
const BLANK_BATCH = 40;
const TICK_BUDGET_MS = 1000;
const LOCK_ATTEMPTS = 4;

export type CdrLabelMark = {
  revision: number;
  done: boolean;
  cursor: string;
};

export type CdrTagNorms = {
  uniqueTagNorm: string;
  radiusSessionNorm: string;
};

export type CdrLabelRow = {
  id: string;
  uniqueTagNorm: string;
  radiusSessionNorm: string;
  afCategory: string | null;
  afStatus: string | null;
};

type LabelPair = { category: string; status: string };

type TraceRead = {
  id: string;
  tagNorm: string;
  open: boolean;
  blocks: unknown;
  afCategory: string | null;
  afStatus: string | null;
};

class ExpandTags extends Error {
  readonly tags: string[];

  constructor(tags: string[]) {
    super("expand tags");
    this.tags = tags;
  }
}

function expandTagsOf(error: unknown): string[] | null {
  if (error instanceof ExpandTags) return error.tags;
  if (!error || typeof error !== "object" || !("cause" in error)) return null;
  return expandTagsOf((error as { cause?: unknown }).cause);
}

/** A mismatched revision is not ready. The click path then keeps today's join. */
export function openCdrLabelMark(raw: unknown): CdrLabelMark {
  if (!raw || typeof raw !== "object") {
    return { revision: AF_LABEL_REVISION, done: false, cursor: "" };
  }
  const row = raw as { revision?: unknown; done?: unknown; cursor?: unknown };
  if (row.revision !== AF_LABEL_REVISION) {
    return { revision: AF_LABEL_REVISION, done: false, cursor: "" };
  }
  return {
    revision: AF_LABEL_REVISION,
    done: row.done === true,
    cursor: typeof row.cursor === "string" ? row.cursor : "",
  };
}

/** Same keys the cell searches. An empty string is not a key. */
export function cdrTagNorms(uniqueTag: string, radiusSessionId: string): CdrTagNorms {
  return {
    uniqueTagNorm: realTag(uniqueTag) ?? "",
    radiusSessionNorm: realTag(radiusSessionId) ?? "",
  };
}

/** Lexicographic lock order. Two writers cannot each hold the other's first tag. */
export function lockOrder(tags: readonly string[]): string[] {
  return [...new Set(tags.filter((tag) => tag.length > 0))].sort();
}

/**
 * Partner key on a matched CDR. Null when every key is already in the lock set.
 * The caller rolls back and locks the returned set from the start.
 */
export function expandedTagSet(
  locked: readonly string[],
  rows: readonly { uniqueTagNorm: string; radiusSessionNorm: string }[],
): string[] | null {
  const needed = new Set(locked.filter((tag) => tag.length > 0));
  for (const row of rows) {
    if (row.uniqueTagNorm) needed.add(row.uniqueTagNorm);
    if (row.radiusSessionNorm) needed.add(row.radiusSessionNorm);
  }
  const next = [...needed].sort();
  const have = [...locked].filter((tag) => tag.length > 0).sort();
  if (next.length === have.length && next.every((tag, index) => tag === have[index]))
    return null;
  return next;
}

/**
 * Backfill and import may fill only a still-null pair.
 * A label written after the read is left alone.
 */
export function cdrLabelWrite(
  onlyNull: boolean,
  id: string,
  current: { category: string | null; status: string | null },
  next: LabelPair,
): {
  where: { id: string; afCategory?: null };
  data: { afCategory: string; afStatus: string };
} | null {
  if (onlyNull && current.category !== null) return null;
  if (current.category === next.category && current.status === next.status) return null;
  return {
    where: onlyNull ? { id, afCategory: null } : { id },
    data: { afCategory: next.category, afStatus: next.status },
  };
}

export function stampImportedCdr<
  T extends {
    uniqueTag?: string;
    radiusSessionId?: string;
    uniqueTagNorm?: string;
    radiusSessionNorm?: string;
    afCategory?: string | null;
    afStatus?: string | null;
  },
>(row: T): string[] {
  const norms = cdrTagNorms(row.uniqueTag ?? "", row.radiusSessionId ?? "");
  row.uniqueTagNorm = norms.uniqueTagNorm;
  row.radiusSessionNorm = norms.radiusSessionNorm;
  const tags = lockOrder([norms.uniqueTagNorm, norms.radiusSessionNorm]);
  if (tags.length === 0) {
    row.afCategory = NO_TRACE_LABELS.category;
    row.afStatus = NO_TRACE_LABELS.status;
  }
  return tags;
}

type Tx = Prisma.TransactionClient;

async function lockTags(tx: Tx, tags: readonly string[]): Promise<void> {
  for (const tag of lockOrder(tags)) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tag}, 0))`;
  }
}

export async function loadCdrsForTags(
  tx: Tx,
  tags: readonly string[],
): Promise<CdrLabelRow[]> {
  const keys = lockOrder(tags);
  if (keys.length === 0) return [];
  return tx.smgCdrRecord.findMany({
    where: {
      OR: [{ uniqueTagNorm: { in: keys } }, { radiusSessionNorm: { in: keys } }],
    },
    select: {
      id: true,
      uniqueTagNorm: true,
      radiusSessionNorm: true,
      afCategory: true,
      afStatus: true,
    },
  });
}

function isTraceBlocks(value: unknown): value is TraceBlocks {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { text?: unknown }).text === "string";
}

function pairFromTrace(trace: TraceRead): LabelPair {
  if (!isTraceBlocks(trace.blocks)) return { ...NO_TRACE_LABELS };
  try {
    return classifyAntifraud({ closed: !trace.open, blocks: trace.blocks });
  } catch (error) {
    logger.warn("smg.cdr.labels_classify_failed", {
      id: trace.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...NO_TRACE_LABELS };
  }
}

async function labelsForRow(
  tx: Tx,
  row: CdrLabelRow,
  traces: TraceRead[],
): Promise<LabelPair> {
  const keys = new Set(lockOrder([row.uniqueTagNorm, row.radiusSessionNorm]));
  const hits = traces.filter((trace) => keys.has(trace.tagNorm));
  const resolved = resolveStoredTraces(
    hits.map((trace) => ({
      id: trace.id,
      category: trace.afCategory,
      status: trace.afStatus,
    })),
  );
  if (resolved.kind === "none") return { ...NO_TRACE_LABELS };
  if (resolved.kind === "ready")
    return { category: resolved.category, status: resolved.status };
  const trace = hits.find((item) => item.id === resolved.traceId);
  const labels = trace ? pairFromTrace(trace) : { ...NO_TRACE_LABELS };
  if (trace) {
    trace.afCategory = labels.category;
    trace.afStatus = labels.status;
    await tx.smgCallTrace.updateMany({
      where: { id: trace.id, afCategory: null },
      data: { afCategory: labels.category, afStatus: labels.status },
    });
  }
  return labels;
}

/** One locked set of CDRs. Pending cards are classified once and stored on the card too. */
export async function writeResolvedCdrLabels(
  tx: Tx,
  rows: readonly CdrLabelRow[],
  opts: { onlyNull: boolean },
): Promise<void> {
  if (rows.length === 0) return;
  const keys = lockOrder(
    rows.flatMap((row) => [row.uniqueTagNorm, row.radiusSessionNorm]),
  );
  const traces: TraceRead[] =
    keys.length === 0
      ? []
      : await tx.smgCallTrace.findMany({
          where: { tagNorm: { in: keys } },
          select: {
            id: true,
            tagNorm: true,
            open: true,
            blocks: true,
            afCategory: true,
            afStatus: true,
          },
        });
  for (const row of rows) {
    const labels = await labelsForRow(tx, row, traces);
    const write = cdrLabelWrite(
      opts.onlyNull,
      row.id,
      { category: row.afCategory, status: row.afStatus },
      labels,
    );
    if (!write) continue;
    await tx.smgCdrRecord.updateMany({ where: write.where, data: write.data });
  }
}

/**
 * Lock the seed tags, run `run`, and retry from scratch when a CDR has another key.
 * `run` returns that larger set to roll the transaction back.
 */
export async function withCdrTagLocks(
  seed: readonly string[],
  run: (tx: Tx, tags: string[]) => Promise<string[] | null>,
): Promise<void> {
  let tags = lockOrder(seed);
  if (tags.length === 0) return;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      await prisma.$transaction(async (tx) => {
        await lockTags(tx, tags);
        const expand = await run(tx, tags);
        if (expand) throw new ExpandTags(lockOrder(expand));
      });
      return;
    } catch (error) {
      const expand = expandTagsOf(error);
      if (expand) {
        tags = expand;
        continue;
      }
      throw error;
    }
  }
  throw new Error("smg cdr label tag set did not settle");
}

/** Re-read cards and write the cell's pair. `onlyNull` does not replace a pair already stored. */
export async function recomputeCdrLabels(
  seed: readonly string[],
  opts: { onlyNull: boolean },
): Promise<void> {
  await withCdrTagLocks(seed, async (tx, tags) => {
    const rows = await loadCdrsForTags(tx, tags);
    const expand = expandedTagSet(tags, rows);
    if (expand) return expand;
    await writeResolvedCdrLabels(tx, rows, opts);
    return null;
  });
}

async function writeMark(mark: CdrLabelMark): Promise<void> {
  const state = mark as unknown as Prisma.InputJsonValue;
  await prisma.smgTraceCheckpoint.upsert({
    where: {
      deviceIp_fileKey: { deviceIp: CDR_LABEL_DEVICE, fileKey: CDR_LABEL_FILE_KEY },
    },
    create: {
      deviceIp: CDR_LABEL_DEVICE,
      fileKey: CDR_LABEL_FILE_KEY,
      size: 0,
      version: 0,
      state,
    },
    update: { state },
  });
}

type RawCdr = {
  id: string;
  unique_tag: string;
  radius_session_id: string;
  unique_tag_norm: string;
  radius_session_norm: string;
  disconnect_time: string;
};

async function refreshStoredRow(row: RawCdr, onlyNull: boolean): Promise<void> {
  const norms = cdrTagNorms(row.unique_tag, row.radius_session_id);
  const where = onlyNull ? { id: row.id, afCategory: null } : { id: row.id };
  if (!norms.uniqueTagNorm && !norms.radiusSessionNorm) {
    await prisma.smgCdrRecord.updateMany({
      where,
      data: {
        uniqueTagNorm: "",
        radiusSessionNorm: "",
        afCategory: NO_TRACE_LABELS.category,
        afStatus: NO_TRACE_LABELS.status,
      },
    });
    return;
  }
  if (
    norms.uniqueTagNorm !== row.unique_tag_norm ||
    norms.radiusSessionNorm !== row.radius_session_norm
  ) {
    await prisma.smgCdrRecord.updateMany({
      where,
      data: {
        uniqueTagNorm: norms.uniqueTagNorm,
        radiusSessionNorm: norms.radiusSessionNorm,
      },
    });
  }
  await recomputeCdrLabels([norms.uniqueTagNorm, norms.radiusSessionNorm], { onlyNull });
}

async function refreshStoredRowSafe(row: RawCdr, onlyNull: boolean): Promise<boolean> {
  try {
    await refreshStoredRow(row, onlyNull);
    return true;
  } catch (error) {
    logger.warn("smg.cdr.labels_row_failed", {
      id: row.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function sweepRevision(mark: CdrLabelMark): Promise<void> {
  const rows = await prisma.$queryRaw<RawCdr[]>`
    SELECT id, unique_tag, radius_session_id, unique_tag_norm, radius_session_norm, disconnect_time
    FROM smg_cdr_records
    WHERE id > ${mark.cursor}
    ORDER BY id
    LIMIT ${SWEEP_BATCH}
  `;
  for (const row of rows) await refreshStoredRow(row, false);
  const cursor = rows.at(-1)?.id ?? mark.cursor;
  const done = rows.length < SWEEP_BATCH;
  await writeMark({ revision: AF_LABEL_REVISION, done, cursor });
  logger.info("smg.cdr.labels_revision", { scanned: rows.length, done });
}

async function fillNullRows(started: number): Promise<void> {
  let filled = 0;
  let month = "";
  const failed = new Set<string>();
  while (Date.now() - started < TICK_BUDGET_MS) {
    const rows = await prisma.$queryRaw<RawCdr[]>`
      SELECT id, unique_tag, radius_session_id, unique_tag_norm, radius_session_norm, disconnect_time
      FROM smg_cdr_records
      WHERE af_category IS NULL
      ORDER BY disconnect_time DESC, id DESC
      LIMIT ${NULL_BATCH}
    `;
    const pending = rows.filter((row) => !failed.has(row.id));
    if (pending.length === 0) break;
    month = pending[0]!.disconnect_time.slice(0, 7);
    for (const row of pending) {
      if (Date.now() - started >= TICK_BUDGET_MS) break;
      if (await refreshStoredRowSafe(row, true)) filled += 1;
      else failed.add(row.id);
    }
    if (rows.length < NULL_BATCH) break;
  }
  if (filled > 0) logger.info("smg.cdr.labels_backfill", { month, filled });
}

/** One short step after the syslog walk. Newest nulls first. A revision sweep replaces that. */
export async function backfillCdrLabelsTick(): Promise<void> {
  if (isDatabaseVacuumActive()) return;
  const stored = await prisma.smgTraceCheckpoint.findUnique({
    where: {
      deviceIp_fileKey: { deviceIp: CDR_LABEL_DEVICE, fileKey: CDR_LABEL_FILE_KEY },
    },
    select: { state: true },
  });
  const mark = openCdrLabelMark(stored?.state);
  if (!mark.done) {
    const storedRevision =
      stored?.state && typeof stored.state === "object"
        ? (stored.state as { revision?: unknown }).revision
        : undefined;
    if (storedRevision !== AF_LABEL_REVISION) {
      await writeMark({ revision: AF_LABEL_REVISION, done: false, cursor: "" });
      await sweepRevision({ revision: AF_LABEL_REVISION, done: false, cursor: "" });
      return;
    }
    await sweepRevision(mark);
    return;
  }
  await fillNullRows(Date.now());
}

/** Every stored pair becomes «Нет данных». Callers turn the fast path off first. */
export async function blankStoredCdrLabels(): Promise<number> {
  let total = 0;
  for (;;) {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      WITH picked AS (
        SELECT id
        FROM smg_cdr_records
        WHERE af_category IS DISTINCT FROM ${NO_TRACE_LABELS.category}
           OR af_status IS DISTINCT FROM ${NO_TRACE_LABELS.status}
           OR af_category IS NULL
        LIMIT ${BLANK_BATCH}
      )
      UPDATE smg_cdr_records AS r
      SET af_category = ${NO_TRACE_LABELS.category},
          af_status = ${NO_TRACE_LABELS.status}
      FROM picked
      WHERE r.id = picked.id
      RETURNING r.id
    `;
    total += rows.length;
    if (rows.length < BLANK_BATCH) return total;
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export async function markCdrLabels(done: boolean): Promise<void> {
  await writeMark({ revision: AF_LABEL_REVISION, done, cursor: "" });
}

/**
 * True when this gateway-month can filter on the stored pair.
 * A missing mark or any null row keeps the join that the table uses today.
 */
export async function cdrLabelsReady(month: CdrMonth, device: string): Promise<boolean> {
  if (!device) return false;
  const range = smgMonthTimeRange(month);
  const revision = String(AF_LABEL_REVISION);
  const rows = await prisma.$queryRaw<Array<{ ready: boolean; pending: boolean }>>`
    SELECT
      EXISTS (
        SELECT 1
        FROM smg_trace_checkpoints
        WHERE device_ip = ${CDR_LABEL_DEVICE}
          AND file_key = ${CDR_LABEL_FILE_KEY}
          AND state->>'revision' = ${revision}
          AND state->>'done' = 'true'
      ) AS ready,
      EXISTS (
        SELECT 1
        FROM smg_cdr_records
        WHERE device_sign = ${device}
          AND disconnect_time >= ${range.gte}
          AND disconnect_time < ${range.lt}
          AND af_category IS NULL
      ) AS pending
  `;
  const row = rows[0];
  return row?.ready === true && row.pending === false;
}
