import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * If a job_run is still `running`, mark it failed.
 * Safe in `finally` after success/fail — updateMany matches 0 rows when already terminal.
 */
export async function failJobRunIfStillRunning(
  jobRunId: string,
  startedAt: Date,
  errorMessage: string,
): Promise<void> {
  try {
    const result = await prisma.jobRun.updateMany({
      where: { id: jobRunId, status: "running" },
      data: {
        status: "failed",
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        errorMessage,
      },
    });
    if (result.count > 0) {
      logger.warn("jobs.forced_terminal_failed", { jobRunId, errorMessage });
    }
  } catch (error) {
    logger.error("jobs.forced_terminal_failed.write_error", {
      jobRunId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
