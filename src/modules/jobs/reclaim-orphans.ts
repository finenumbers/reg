/**
 * Mark in-flight job_runs as failed after process restart.
 * In-memory anti-overlap does not survive a crash; DB rows would stay "running".
 */

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export const ORPHAN_RECLAIM_MESSAGE = "interrupted: process restarted";

export type ReclaimedPurgeJob = {
  id: string;
  errorMessage: string | null;
  phonesParsed: number | null;
  meta: unknown;
};

export async function reclaimOrphanJobRuns(): Promise<{
  reclaimed: number;
  runningPurges: ReclaimedPurgeJob[];
}> {
  const runningPurges = await prisma.jobRun.findMany({
    where: { status: "running", actionCode: "cdr.purge.month" },
    select: { id: true, errorMessage: true, phonesParsed: true, meta: true },
  });
  const result = await prisma.jobRun.updateMany({
    where: { status: "running" },
    data: {
      status: "failed",
      finishedAt: new Date(),
      errorMessage: ORPHAN_RECLAIM_MESSAGE,
    },
  });

  if (result.count > 0) {
    logger.warn("jobs.orphans_reclaimed", { count: result.count });
  }

  return { reclaimed: result.count, runningPurges };
}
