import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { projectSpan, SMG_TRACE_PARSER_VERSION } from "@/modules/smg-trace/assemble";
import { classifyAntifraud } from "@/modules/smg-trace/classify";
import {
  advanceLabelMark,
  LABEL_BATCH,
  LABEL_DEVICE,
  LABEL_FILE_KEY,
  openLabelMark,
} from "@/modules/smg-trace/label-pass";
import { cardFromBlocks, logCardDiverge, mergeTraceCard } from "@/modules/smg-trace/merge";
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
import { syslogRoot } from "@/modules/smg-syslog/paths";
import { isDatabaseVacuumActive } from "@/modules/storage/vacuum/gate";

let running = false;

/** One pass at a time, outside CDR import and outside the UDP receiver. */
export async function drainSmgTraces(root = syslogRoot()): Promise<void> {
  if (running || isDatabaseVacuumActive()) return;
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
        await prisma.smgCallTrace.deleteMany();
      },
    });
    for (const deviceIp of listDeviceIps(root)) {
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
    await prisma.smgCallTrace.deleteMany({ where: { deviceIp } });
  },
  async saveSpan(deviceIp, span) {
    const projected = projectSpan(span);
    const incoming = {
      text: projected.text,
      mismatch: projected.mismatch,
      startedKey: projected.startedKey ?? "",
      open: !span.sealed,
    };
    const existing = await prisma.smgCallTrace.findUnique({
      where: { deviceIp_tagNorm: { deviceIp, tagNorm: span.tag } },
      select: { blocks: true, open: true },
    });
    const stored =
      existing && isTraceBlocks(existing.blocks) ? cardFromBlocks(existing.blocks, existing.open) : null;
    const merged = mergeTraceCard(stored, incoming);
    if (merged.diverged) logCardDiverge(span.tag, stored?.text.length ?? 0, incoming.text.length);
    const blocks = {
      text: merged.text,
      mismatch: merged.mismatch,
      startedKey: merged.startedKey,
    };
    const labels = classifyAntifraud({ closed: !merged.open, blocks });
    const payload = blocks as Prisma.InputJsonValue;
    await prisma.smgCallTrace.upsert({
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
    select: { id: true, open: true, blocks: true },
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
    await prisma.smgCallTrace.update({
      where: { id: row.id },
      data: { afCategory: labels.category, afStatus: labels.status },
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
    select: { id: true, open: true, blocks: true, afCategory: true, afStatus: true, updatedAt: true },
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
    await prisma.smgCallTrace.updateMany({
      where: { id: row.id, updatedAt: row.updatedAt },
      data: { afCategory: labels.category, afStatus: labels.status },
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
