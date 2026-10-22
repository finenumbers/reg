import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { projectSpan, SMG_TRACE_PARSER_VERSION } from "@/modules/smg-trace/assemble";
import { classifyAntifraud } from "@/modules/smg-trace/classify";
import {
  advanceDelayMark,
  DELAY_BATCH,
  DELAY_DEVICE,
  DELAY_FILE_KEY,
  openDelayMark,
} from "@/modules/smg-trace/delay-pass";
import {
  advanceLabelMark,
  LABEL_BATCH,
  LABEL_DEVICE,
  LABEL_FILE_KEY,
  openLabelMark,
} from "@/modules/smg-trace/label-pass";
import {
  cardFromBlocks,
  logCardDiverge,
  mergeTraceCard,
} from "@/modules/smg-trace/merge";
import {
  fillDelaySampleSql,
  writeDelaySamplesSql,
} from "@/modules/smg-trace/delay-samples";
import { radiusDelaySamples } from "@/modules/smg-trace/summary";
import {
  backfillCdrLabelsTick,
  blankStoredCdrLabels,
  expandedTagSet,
  loadCdrsForTags,
  markCdrLabels,
  withCdrTagLocks,
  writeResolvedCdrLabels,
} from "@/modules/smg/cdr-labels";
import { NO_TRACE_LABELS } from "@/modules/smg/row-tokens";
import type { TraceBlocks } from "@/modules/smg-trace/types";
import {
  forgetCardsIfUnmarked,
  listDeviceIps,
  listTraceSourcesSince,
  LIVE_FILE_KEY,
  readLiveFloor,
  stepDevice,
  type TraceRepository,
} from "@/modules/smg-trace/walk";
import {
  isJournalResetDone,
  resetRadiusJournalOnce,
} from "@/modules/antifraud/journal-reset";
import { syslogRoot } from "@/modules/smg-syslog/paths";
import { deferTraceCut } from "@/modules/smg-trace/cut-gate";
import { isDatabaseVacuumActive } from "@/modules/storage/vacuum/gate";
import { getPurgeTargetMonth } from "@/modules/traffic/purge/target";

let running = false;
let cutSettled = false;

/** Pages of the one-time CDR label blank. The steady pass stays at 40. */
const CUT_LABEL_BATCH = 2000;

async function cutStillPending(): Promise<boolean> {
  const [journalDone, rows] = await Promise.all([
    isJournalResetDone(),
    prisma.smgTraceCheckpoint.findMany({
      where: { fileKey: LIVE_FILE_KEY },
      select: { version: true },
    }),
  ]);
  return deferTraceCut({
    vacuum: false,
    purge: true,
    journalDone,
    hasCurrentLiveMark: rows.some((row) => row.version === SMG_TRACE_PARSER_VERSION),
  });
}

/**
 * Directories whose node is explicitly off stay at their checkpoint.
 * A directory with no node row is still walked.
 */
export function traceDeviceIps(
  dirs: readonly string[],
  disabledIps: ReadonlySet<string>,
): string[] {
  return dirs.filter((ip) => !disabledIps.has(ip));
}

/** One pass at a time, outside CDR import and outside the UDP receiver. */
export async function drainSmgTraces(root = syslogRoot()): Promise<void> {
  if (running || isDatabaseVacuumActive()) return;
  if (!cutSettled && getPurgeTargetMonth() !== null && (await cutStillPending())) return;
  running = true;
  try {
    await forgetCardsIfUnmarked({
      async liveMarkVersions() {
        const rows = await prisma.smgTraceCheckpoint.findMany({
          where: { fileKey: LIVE_FILE_KEY },
          select: { version: true },
        });
        return rows.map((row) => row.version);
      },
      async deleteAllCards() {
        await markCdrLabels(false);
        await prisma.smgCallTrace.deleteMany();
        await blankStoredCdrLabels(CUT_LABEL_BATCH);
        await markCdrLabels(true);
      },
    });
    await resetRadiusJournalOnce();
    const disabledRows = await prisma.smgSyslogNode.findMany({
      where: { antifraudEnabled: false },
      select: { ip: true },
    });
    const disabledIps = new Set(disabledRows.map((row) => row.ip));
    for (const deviceIp of traceDeviceIps(listDeviceIps(root), disabledIps)) {
      try {
        const floor = await liveFloor(deviceIp);
        const files = listTraceSourcesSince(root, deviceIp, floor);
        await stepDevice(deviceIp, files, prismaRepository);
      } catch (error) {
        logger.warn("smg.trace.device_failed", {
          deviceIp,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
    }
    await backfillTraceLabels();
    await relabelStoredCards();
    await backfillCdrLabelsTick();
    await backfillDelaySamples();
    if (!cutSettled && !(await cutStillPending())) cutSettled = true;
  } catch (error) {
    logger.warn("smg.trace.drain_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    running = false;
  }
}

async function liveFloor(deviceIp: string): Promise<string | null> {
  const row = await prisma.smgTraceCheckpoint.findUnique({
    where: { deviceIp_fileKey: { deviceIp, fileKey: LIVE_FILE_KEY } },
    select: { version: true, state: true },
  });
  if (!row || row.version !== SMG_TRACE_PARSER_VERSION) return null;
  return readLiveFloor(row.state);
}

const prismaRepository: TraceRepository = {
  async loadCheckpointMeta(deviceIp) {
    return prisma.smgTraceCheckpoint.findMany({
      where: { deviceIp },
      select: { fileKey: true, size: true, version: true },
    });
  },
  async loadCheckpointState(deviceIp, fileKey) {
    const row = await prisma.smgTraceCheckpoint.findUnique({
      where: { deviceIp_fileKey: { deviceIp, fileKey } },
      select: { state: true },
    });
    return row?.state ?? null;
  },
  async deleteStaleCheckpoints(deviceIp) {
    await prisma.smgTraceCheckpoint.deleteMany({
      where: { deviceIp, version: { not: SMG_TRACE_PARSER_VERSION } },
    });
  },
  async deleteCards(deviceIp) {
    const found = await prisma.smgCallTrace.findMany({
      where: { deviceIp },
      select: { tagNorm: true },
    });
    await prisma.smgCallTrace.deleteMany({ where: { deviceIp, tagNorm: "" } });
    const tags = [
      ...new Set(found.map((row) => row.tagNorm).filter((tag) => tag.length > 0)),
    ];
    for (const tag of tags) {
      await withCdrTagLocks([tag], async (tx, locked) => {
        await tx.smgCallTrace.deleteMany({ where: { deviceIp, tagNorm: tag } });
        const cdrs = await loadCdrsForTags(tx, locked);
        const expand = expandedTagSet(locked, cdrs);
        if (expand) return expand;
        await writeResolvedCdrLabels(tx, cdrs, { onlyNull: false });
        return null;
      });
    }
  },
  async saveSpan(deviceIp, span) {
    if (!span.tag) return;
    await withCdrTagLocks([span.tag], async (tx, tags) => {
      const projected = projectSpan(span);
      const incoming = {
        text: projected.text,
        mismatch: projected.mismatch,
        startedKey: projected.startedKey ?? "",
        open: !span.sealed,
      };
      const existing = await tx.smgCallTrace.findUnique({
        where: { deviceIp_tagNorm: { deviceIp, tagNorm: span.tag } },
        select: { blocks: true, open: true },
      });
      const stored =
        existing && isTraceBlocks(existing.blocks)
          ? cardFromBlocks(existing.blocks, existing.open)
          : null;
      const merged = mergeTraceCard(stored, incoming);
      if (merged.diverged)
        logCardDiverge(span.tag, stored?.text.length ?? 0, incoming.text.length);
      const blocks = {
        text: merged.text,
        mismatch: merged.mismatch,
        startedKey: merged.startedKey,
      };
      const labels = classifyAntifraud({ closed: !merged.open, blocks });
      const samples = radiusDelaySamples(merged.text);
      const payload = blocks as Prisma.InputJsonValue;
      await tx.smgCallTrace.upsert({
        where: { deviceIp_tagNorm: { deviceIp, tagNorm: span.tag } },
        create: {
          deviceIp,
          tagNorm: span.tag,
          callref: span.callref,
          open: merged.open,
          blocks: payload,
          afCategory: labels.category,
          afStatus: labels.status,
        },
        update: {
          callref: span.callref,
          open: merged.open,
          blocks: payload,
          afCategory: labels.category,
          afStatus: labels.status,
        },
      });
      await tx.$executeRaw(
        writeDelaySamplesSql({
          deviceIp,
          tagNorm: span.tag,
          dev: samples.afMsDev,
          prod: samples.afMsProd,
          parking: samples.afMsParking,
        }),
      );
      const cdrs = await loadCdrsForTags(tx, tags);
      const expand = expandedTagSet(tags, cdrs);
      if (expand) return expand;
      await writeResolvedCdrLabels(tx, cdrs, { onlyNull: false });
      return null;
    });
  },
  async saveCheckpoint(deviceIp, fileKey, size, state) {
    const json = state as unknown as Prisma.InputJsonValue;
    await prisma.smgTraceCheckpoint.upsert({
      where: { deviceIp_fileKey: { deviceIp, fileKey } },
      create: {
        deviceIp,
        fileKey,
        size,
        version: SMG_TRACE_PARSER_VERSION,
        state: json,
      },
      update: {
        size,
        version: SMG_TRACE_PARSER_VERSION,
        state: json,
      },
    });
  },
};

function parseBlocks(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isTraceBlocks(value: unknown): value is TraceBlocks {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { text?: unknown }).text === "string";
}

/** Cards saved before labels existed. One drain tick fills a batch and does not block the file walk. */
async function backfillTraceLabels(): Promise<void> {
  const rows = await prisma.smgCallTrace.findMany({
    where: { afCategory: null },
    orderBy: { id: "asc" },
    take: 200,
    select: { id: true, open: true, blocks: true, tagNorm: true },
  });
  if (rows.length === 0) return;
  for (const row of rows) {
    let labels: { category: string; status: string } = NO_TRACE_LABELS;
    if (isTraceBlocks(row.blocks)) {
      try {
        labels = classifyAntifraud({ closed: !row.open, blocks: row.blocks });
      } catch (error) {
        logger.warn("smg.trace.labels_backfill_failed", {
          id: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (!row.tagNorm) {
      await prisma.smgCallTrace.updateMany({
        where: { id: row.id, afCategory: null },
        data: { afCategory: labels.category, afStatus: labels.status },
      });
      continue;
    }
    await withCdrTagLocks([row.tagNorm], async (tx, tags) => {
      const updated = await tx.smgCallTrace.updateMany({
        where: { id: row.id, afCategory: null },
        data: { afCategory: labels.category, afStatus: labels.status },
      });
      if (updated.count === 0) return null;
      const cdrs = await loadCdrsForTags(tx, tags);
      const expand = expandedTagSet(tags, cdrs);
      if (expand) return expand;
      await writeResolvedCdrLabels(tx, cdrs, { onlyNull: false });
      return null;
    });
  }
  logger.info("smg.trace.labels_backfill", { filled: rows.length });
}

/**
 * One revision of the classifier, applied to cards already stored.
 * A card saved again during the batch keeps the labels from that save.
 */
async function relabelStoredCards(): Promise<void> {
  const stored = await prisma.smgTraceCheckpoint.findUnique({
    where: { deviceIp_fileKey: { deviceIp: LABEL_DEVICE, fileKey: LABEL_FILE_KEY } },
    select: { state: true },
  });
  const mark = openLabelMark(stored?.state);
  if (mark.done) return;
  const rows = await prisma.smgCallTrace.findMany({
    where: mark.cursor ? { id: { gt: mark.cursor } } : {},
    orderBy: { id: "asc" },
    take: LABEL_BATCH,
    select: {
      id: true,
      tagNorm: true,
      open: true,
      blocks: true,
      afCategory: true,
      afStatus: true,
      updatedAt: true,
    },
  });
  for (const row of rows) {
    let labels: { category: string; status: string } = NO_TRACE_LABELS;
    if (isTraceBlocks(row.blocks)) {
      try {
        labels = classifyAntifraud({ closed: !row.open, blocks: row.blocks });
      } catch (error) {
        logger.warn("smg.trace.labels_revision_failed", {
          id: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }
    if (row.afCategory === labels.category && row.afStatus === labels.status) continue;
    if (!row.tagNorm) {
      await prisma.smgCallTrace.updateMany({
        where: { id: row.id, updatedAt: row.updatedAt },
        data: { afCategory: labels.category, afStatus: labels.status },
      });
      continue;
    }
    await withCdrTagLocks([row.tagNorm], async (tx, tags) => {
      const updated = await tx.smgCallTrace.updateMany({
        where: { id: row.id, updatedAt: row.updatedAt },
        data: { afCategory: labels.category, afStatus: labels.status },
      });
      if (updated.count === 0) return null;
      const cdrs = await loadCdrsForTags(tx, tags);
      const expand = expandedTagSet(tags, cdrs);
      if (expand) return expand;
      await writeResolvedCdrLabels(tx, cdrs, { onlyNull: false });
      return null;
    });
  }
  const next = advanceLabelMark(
    mark,
    rows.map((row) => row.id),
    LABEL_BATCH,
  );
  const state = next as unknown as Prisma.InputJsonValue;
  await prisma.smgTraceCheckpoint.upsert({
    where: { deviceIp_fileKey: { deviceIp: LABEL_DEVICE, fileKey: LABEL_FILE_KEY } },
    create: {
      deviceIp: LABEL_DEVICE,
      fileKey: LABEL_FILE_KEY,
      size: 0,
      version: SMG_TRACE_PARSER_VERSION,
      state,
    },
    update: {
      size: 0,
      version: SMG_TRACE_PARSER_VERSION,
      state,
    },
  });
  logger.info("smg.trace.labels_revision", { scanned: rows.length, done: next.done });
}

/**
 * Cards saved before the delay arrays existed. One tick fills a page of NULLs.
 * The update keeps the NULL condition so a save that landed between the read
 * and the write is not replaced with the older text.
 */
async function backfillDelaySamples(): Promise<void> {
  const stored = await prisma.smgTraceCheckpoint.findUnique({
    where: { deviceIp_fileKey: { deviceIp: DELAY_DEVICE, fileKey: DELAY_FILE_KEY } },
    select: { state: true },
  });
  const mark = openDelayMark(stored?.state);
  if (mark.done) return;
  const rows = await prisma.$queryRaw<Array<{ id: string; blocks: unknown }>>`
    SELECT id, blocks
    FROM smg_call_traces
    WHERE af_ms_dev IS NULL
    ORDER BY id ASC
    LIMIT ${DELAY_BATCH}
  `;
  for (const row of rows) {
    const blocks = typeof row.blocks === "string" ? parseBlocks(row.blocks) : row.blocks;
    let samples = {
      afMsDev: [] as number[],
      afMsProd: [] as number[],
      afMsParking: [] as number[],
    };
    if (isTraceBlocks(blocks)) {
      try {
        samples = radiusDelaySamples(blocks.text);
      } catch (error) {
        logger.warn("smg.trace.delay_backfill_failed", {
          id: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await prisma.$executeRaw(
      fillDelaySampleSql({
        id: row.id,
        dev: samples.afMsDev,
        prod: samples.afMsProd,
        parking: samples.afMsParking,
      }),
    );
  }
  const next = advanceDelayMark(mark, rows.length, DELAY_BATCH);
  const state = next as unknown as Prisma.InputJsonValue;
  await prisma.smgTraceCheckpoint.upsert({
    where: { deviceIp_fileKey: { deviceIp: DELAY_DEVICE, fileKey: DELAY_FILE_KEY } },
    create: {
      deviceIp: DELAY_DEVICE,
      fileKey: DELAY_FILE_KEY,
      size: 0,
      version: SMG_TRACE_PARSER_VERSION,
      state,
    },
    update: {
      size: 0,
      version: SMG_TRACE_PARSER_VERSION,
      state,
    },
  });
  logger.info("smg.trace.delay_backfill", { filled: rows.length, done: next.done });
}
