import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { projectSpan, SMG_TRACE_PARSER_VERSION } from "@/modules/smg-trace/assemble";
import {
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
    const blocks = projectSpan(span) as Prisma.InputJsonValue;
    await prisma.smgCallTrace.upsert({
      where: { deviceIp_tagNorm: { deviceIp, tagNorm: span.tag } },
      create: {
        deviceIp,
        tagNorm: span.tag,
        callref: span.callref,
        open: !span.ended,
        blocks,
      },
      update: {
        callref: span.callref,
        open: !span.ended,
        blocks,
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
