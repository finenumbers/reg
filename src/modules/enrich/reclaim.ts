import { rm } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  ENRICH_ARTIFACT_TTL_MS,
  failOpenEnrichStages,
  INITIAL_STAGES,
  type EnrichStageView,
} from "@/modules/enrich/types";
import { enrichDataRoot, enrichJobDir } from "@/modules/enrich/paths";

export const ENRICH_ORPHAN_MESSAGE = "interrupted: process restarted";

export async function reclaimOrphanEnrichJobs(): Promise<{ reclaimed: number }> {
  const rows = await prisma.enrichJob.findMany({
    where: { status: { in: ["queued", "running"] } },
    select: { id: true, stages: true },
  });
  const finishedAt = new Date();
  for (const row of rows) {
    const stages = Array.isArray(row.stages)
      ? (row.stages as EnrichStageView[])
      : INITIAL_STAGES;
    await prisma.enrichJob.update({
      where: { id: row.id },
      data: {
        status: "failed",
        finishedAt,
        errorMessage: ENRICH_ORPHAN_MESSAGE,
        stages: failOpenEnrichStages(stages, ENRICH_ORPHAN_MESSAGE),
      },
    });
  }
  if (rows.length > 0) {
    logger.warn("enrich.orphans_reclaimed", { count: rows.length });
  }
  return { reclaimed: rows.length };
}

export async function pruneEnrichArtifacts(
  now: Date = new Date(),
): Promise<{ removed: number }> {
  const root = enrichDataRoot();
  let removed = 0;
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return { removed: 0 };
  }

  const cutoff = new Date(now.getTime() - ENRICH_ARTIFACT_TTL_MS);
  const stale = await prisma.enrichJob.findMany({
    where: {
      OR: [
        { finishedAt: { lt: cutoff } },
        { status: "failed", updatedAt: { lt: cutoff } },
      ],
    },
    select: { id: true },
  });
  const staleIds = new Set(stale.map((row) => row.id));

  for (const name of entries) {
    if (!staleIds.has(name)) continue;
    try {
      await rm(path.join(root, name), { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      logger.warn("enrich.artifact_prune_failed", {
        jobId: name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { removed };
}

export async function removeJobDir(jobId: string): Promise<void> {
  await rm(enrichJobDir(jobId), { recursive: true, force: true });
}
