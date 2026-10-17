import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { projectSpan, SMG_TRACE_PARSER_VERSION } from "@/modules/smg-trace/assemble";
import {
  listTraceSources,
  stepDevice,
  type TraceRepository,
  type TraceSource,
} from "@/modules/smg-trace/walk";
import { syslogRoot } from "@/modules/smg-syslog/paths";
import { isDatabaseVacuumActive } from "@/modules/storage/vacuum/gate";

let running = false;

/** One pass at a time, outside CDR import and outside the UDP receiver. */
export async function drainSmgTraces(root = syslogRoot()): Promise<void> {
  if (running || isDatabaseVacuumActive()) return;
  running = true;
  try {
    const byDevice = new Map<string, TraceSource[]>();
    for (const source of listTraceSources(root)) {
      const list = byDevice.get(source.deviceIp) ?? [];
      list.push(source);
      byDevice.set(source.deviceIp, list);
    }
    for (const [deviceIp, files] of byDevice) {
      try {
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
  async clearCheckpointState(deviceIp, fileKey) {
    await prisma.smgTraceCheckpoint.updateMany({
      where: { deviceIp, fileKey },
      data: { state: {} },
    });
  },
  async saveSpan(deviceIp, span) {
    const blocks = projectSpan(span) as Prisma.InputJsonValue;
    await prisma.smgCallTrace.upsert({
      where: { deviceIp_tagNorm: { deviceIp, tagNorm: span.tag } },
      create: {
        deviceIp,
        tagNorm: span.tag,
        callref: span.callref,
        open: !span.echoed,
        blocks,
      },
      update: {
        callref: span.callref,
        open: !span.echoed,
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
