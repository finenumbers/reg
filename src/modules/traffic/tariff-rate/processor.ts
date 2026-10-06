/**
 * cdr.tariff.rate — rewrite stored tariff cells for the current snapshot.
 * One short transaction per primary-key batch. Unchanged rows are not written.
 */

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { failJobRunIfStillRunning } from "@/modules/jobs/finalize";
import { CDR_TARIFF_BATCH_SQL } from "@/modules/traffic/tariff-rate/sql";

const BATCH = 5000;
const DEADLOCK_ATTEMPTS = 5;

export type CdrTariffRateInput = {
  trigger: "schedule" | "manual" | "test";
  actorUserId?: string;
};

export type CdrTariffRateResult = {
  status: "success" | "failed";
  jobRunId: string;
  changesCount: number;
  errorMessage?: string;
};

type BatchRow = {
  last_id: string | null;
  scanned: bigint | number | string | null;
  updated: bigint | number | string | null;
};

function asNumber(value: bigint | number | string | null | undefined): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDeadlock(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("40P01") || /deadlock/i.test(message);
}

async function tariffRateBlocked(): Promise<boolean> {
  const { jobRuntime } = await import("@/modules/jobs/runtime");
  return (
    jobRuntime.isInFlight("cdr.import") ||
    jobRuntime.isInFlight("cdr.sides.refresh") ||
    jobRuntime.isInFlight("cdr.purge.month")
  );
}

async function waitUntilTariffRateCanRun(): Promise<void> {
  let announced = false;
  while (await tariffRateBlocked()) {
    if (!announced) {
      logger.info("cdr.tariff.rate.waiting");
      announced = true;
    }
    await sleep(1000);
  }
}

async function runBatch(cursor: string): Promise<BatchRow> {
  for (let attempt = 1; ; attempt++) {
    try {
      const rows = await prisma.$queryRawUnsafe<BatchRow[]>(
        CDR_TARIFF_BATCH_SQL,
        cursor,
        BATCH,
      );
      const row = rows[0];
      if (!row) throw new Error("cdr tariff batch returned no summary row");
      return row;
    } catch (error) {
      if (attempt >= DEADLOCK_ATTEMPTS || !isDeadlock(error)) throw error;
      await sleep(200 * attempt);
    }
  }
}

async function walkGeneration(generation: number): Promise<{
  scanned: number;
  updated: number;
}> {
  let cursor = "";
  let scanned = 0;
  let updated = 0;
  for (;;) {
    await waitUntilTariffRateCanRun();
    const row = await runBatch(cursor);
    const batchScanned = asNumber(row.scanned);
    if (batchScanned === 0) break;
    if (typeof row.last_id !== "string" || row.last_id.length === 0) {
      throw new Error("cdr tariff batch returned rows without last_id");
    }
    scanned += batchScanned;
    updated += asNumber(row.updated);
    cursor = row.last_id;
    logger.info("cdr.tariff.rate.batch", { generation, scanned, updated });
  }
  return { scanned, updated };
}

export async function processCdrTariffRate(
  input: CdrTariffRateInput,
): Promise<CdrTariffRateResult> {
  const startedAt = new Date();
  const jobRun = await prisma.jobRun.create({
    data: {
      actionCode: "cdr.tariff.rate",
      trigger: input.trigger,
      status: "running",
      startedAt,
      actorUserId: input.actorUserId ?? null,
    },
  });

  let scanned = 0;
  let updated = 0;

  try {
    await auditService.append({
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.CDR_TARIFF_RATE_START,
      entityType: "job_run",
      entityId: jobRun.id,
      meta: { trigger: input.trigger, phase: "started" },
    });

    for (;;) {
      const state = await prisma.tariffImportState.findUnique({
        where: { id: 1 },
        select: { rateGeneration: true, ratedGeneration: true },
      });
      if (!state || state.rateGeneration === state.ratedGeneration) break;

      const generation = state.rateGeneration;
      const pass = await walkGeneration(generation);
      scanned += pass.scanned;
      updated += pass.updated;

      const marked = await prisma.tariffImportState.updateMany({
        where: { id: 1, rateGeneration: generation },
        data: { ratedGeneration: generation },
      });
      if (marked.count === 1) break;
    }

    const finishedAt = new Date();
    const safeUpdated = updated <= 2_147_483_647 ? updated : null;
    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: {
        status: "success",
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        changesCount: safeUpdated,
        meta: { scanned, updated, phase: "finished" },
      },
    });
    await auditService.append({
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.CDR_TARIFF_RATE_FINISH,
      entityType: "job_run",
      entityId: jobRun.id,
      meta: { scanned, updated },
    });
    return { status: "success", jobRunId: jobRun.id, changesCount: updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("cdr.tariff.rate.failed", { jobRunId: jobRun.id, error: message });
    await failJobRunIfStillRunning(jobRun.id, startedAt, message);
    return {
      status: "failed",
      jobRunId: jobRun.id,
      changesCount: updated,
      errorMessage: message,
    };
  }
}
