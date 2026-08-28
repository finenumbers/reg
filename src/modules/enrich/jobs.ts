import { prisma } from "@/lib/db";
import type { EnrichJobStatus, Prisma } from "@/generated/prisma/client";
import {
  INITIAL_STAGES,
  isFinishedEnrichJob,
  type EnrichJobView,
  type EnrichStageId,
  type EnrichStageView,
  type EnrichSummary,
} from "@/modules/enrich/types";
import { enrichedDownloadName } from "@/modules/enrich/paths";
import { removeJobDir } from "@/modules/enrich/reclaim";

export function toJobView(row: {
  id: string;
  status: EnrichJobStatus;
  sourceFilename: string;
  stages: Prisma.JsonValue;
  summary: Prisma.JsonValue | null;
  errorMessage: string | null;
}): EnrichJobView {
  const stages = Array.isArray(row.stages)
    ? (row.stages as EnrichStageView[])
    : INITIAL_STAGES;
  return {
    id: row.id,
    status: row.status,
    sourceFilename: row.sourceFilename,
    stages,
    summary: (row.summary as EnrichSummary | null) ?? null,
    errorMessage: row.errorMessage,
    downloadUrl:
      row.status === "completed"
        ? `/api/enrich/${row.id}/download`
        : null,
  };
}

export async function findActiveEnrichJob(): Promise<{ id: string } | null> {
  return prisma.enrichJob.findFirst({
    where: { status: { in: ["queued", "running"] } },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function createEnrichJob(input: {
  actorUserId: string;
  sourceFilename: string;
}): Promise<string> {
  const row = await prisma.enrichJob.create({
    data: {
      status: "queued",
      actorUserId: input.actorUserId,
      sourceFilename: input.sourceFilename,
      stages: INITIAL_STAGES,
    },
  });
  return row.id;
}

export async function getEnrichJob(
  id: string,
): Promise<EnrichJobView | null> {
  const row = await prisma.enrichJob.findUnique({ where: { id } });
  if (!row) return null;
  return toJobView(row);
}

/** In-progress job only — finished results are dismissed and not restored. */
export async function getCurrentEnrichJob(
  actorUserId: string,
): Promise<EnrichJobView | null> {
  const row = await prisma.enrichJob.findFirst({
    where: { actorUserId, status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  return toJobView(row);
}

export async function dismissFinishedEnrichJob(
  id: string,
  actorUserId: string,
): Promise<"dismissed" | "not_found" | "active"> {
  const row = await prisma.enrichJob.findUnique({ where: { id } });
  if (!row || row.actorUserId !== actorUserId) return "not_found";
  if (!isFinishedEnrichJob(row)) return "active";
  await removeJobDir(id);
  await prisma.enrichJob.delete({ where: { id } });
  return "dismissed";
}

export async function assertJobOwner(
  id: string,
  actorUserId: string,
): Promise<EnrichJobView | null> {
  const row = await prisma.enrichJob.findUnique({ where: { id } });
  if (!row || row.actorUserId !== actorUserId) return null;
  return toJobView(row);
}

let lastProgressAt = 0;

export async function patchJob(
  id: string,
  data: {
    status?: EnrichJobStatus;
    stages?: EnrichStageView[];
    summary?: EnrichSummary;
    errorMessage?: string | null;
    startedAt?: Date;
    finishedAt?: Date;
    throttle?: boolean;
  },
): Promise<void> {
  const now = Date.now();
  if (data.throttle && now - lastProgressAt < 400 && !data.status) {
    return;
  }
  lastProgressAt = now;
  await prisma.enrichJob.update({
    where: { id },
    data: {
      ...(data.status ? { status: data.status } : {}),
      ...(data.stages ? { stages: data.stages } : {}),
      ...(data.summary ? { summary: data.summary } : {}),
      ...(data.errorMessage !== undefined
        ? { errorMessage: data.errorMessage }
        : {}),
      ...(data.startedAt ? { startedAt: data.startedAt } : {}),
      ...(data.finishedAt ? { finishedAt: data.finishedAt } : {}),
    },
  });
}

export function setStage(
  stages: EnrichStageView[],
  id: EnrichStageId,
  patch: Partial<EnrichStageView>,
): EnrichStageView[] {
  return stages.map((stage) =>
    stage.id === id ? { ...stage, ...patch } : stage,
  );
}

export { enrichedDownloadName };
