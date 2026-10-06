import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function requestCdrTariffRate(
  trigger: "schedule" | "manual" | "test" = "schedule",
): Promise<void> {
  const state = await prisma.tariffImportState.findUnique({
    where: { id: 1 },
    select: { rateGeneration: true, ratedGeneration: true },
  });
  if (!state || state.rateGeneration === state.ratedGeneration) return;

  const { jobRuntime } = await import("@/modules/jobs/runtime");
  const result = await jobRuntime.enqueue({
    actionCode: "cdr.tariff.rate",
    trigger,
  });
  if (!result.accepted) {
    logger.info("cdr.tariff.rate.enqueue_skipped", { reason: result.reason });
  }
}
