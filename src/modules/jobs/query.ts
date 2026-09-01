/**
 * Job runs query service — list recent polls/jobs from local DB for operator UI.
 * Never exposes SSH secrets or raw private key material.
 */

import type { JobStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { truncateUtf8 } from "@/lib/utf8-truncate";
import { countUnenrichedCdrEnrich } from "@/modules/traffic/enrich-import";
import {
  countParkedVoipmonitor,
  countUnenrichedVoipmonitor,
  hasVoipmonitorWork,
} from "@/modules/voipmonitor/count";

/** Keep list payloads small; Prisma dumps in errorMessage can be huge. */
export const JOB_LIST_ERROR_MAX_BYTES = 2048;

async function settleProbe<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logger.warn("jobs.list.probe_failed", {
      probe: label,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

export type ListJobRunsFilters = {
  status?: JobStatus;
  actionCode?: string;
  page?: number;
  pageSize?: number;
};

export type JobRunListItem = {
  id: string;
  actionCode: string;
  trigger: "schedule" | "manual" | "test";
  status: JobStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  exitCode: number | null;
  phonesParsed: number | null;
  linesBad: number | null;
  changesCount: number | null;
  actorUserId: string | null;
  actorUsername: string | null;
  hasArtifact: boolean;
};

export type ListJobRunsResult = {
  items: JobRunListItem[];
  total: number;
  page: number;
  pageSize: number;
  voipmonitorUnenrichedCount: number;
  voipmonitorEnabled: boolean;
  voipmonitorHasWork: boolean;
  voipmonitorParkedCount: number;
  cdrEnrichUnenrichedCount: number;
};

function toListItem(
  row: {
    id: string;
    actionCode: string;
    trigger: "schedule" | "manual" | "test";
    status: JobStatus;
    startedAt: Date;
    finishedAt: Date | null;
    durationMs: number | null;
    errorMessage: string | null;
    exitCode: number | null;
    phonesParsed: number | null;
    linesBad: number | null;
    changesCount: number | null;
    actorUserId: string | null;
    artifact: { jobRunId: string } | null;
  },
  actorUsername: string | null,
): JobRunListItem {
  return {
    id: row.id,
    actionCode: row.actionCode,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    errorMessage: row.errorMessage
      ? truncateUtf8(row.errorMessage, JOB_LIST_ERROR_MAX_BYTES)
      : null,
    exitCode: row.exitCode,
    phonesParsed: row.phonesParsed,
    linesBad: row.linesBad,
    changesCount: row.changesCount,
    actorUserId: row.actorUserId,
    actorUsername,
    hasArtifact: row.artifact != null,
  };
}

export async function listJobRuns(
  filters: ListJobRunsFilters = {},
): Promise<ListJobRunsResult> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 100));

  const where: Prisma.JobRunWhereInput = {};
  if (filters.status) {
    where.status = filters.status;
  }
  if (filters.actionCode?.trim()) {
    where.actionCode = filters.actionCode.trim();
  }

  const [
    total,
    rows,
    voipmonitorUnenrichedCount,
    voipmonitorSettings,
    voipmonitorHasWork,
    voipmonitorParkedCount,
    cdrEnrichUnenrichedCount,
  ] = await Promise.all([
    prisma.jobRun.count({ where }),
    prisma.jobRun.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        artifact: { select: { jobRunId: true } },
      },
    }),
    settleProbe("unenriched", countUnenrichedVoipmonitor, 0),
    prisma.appSetting.findUnique({
      where: { id: 1 },
      select: { voipmonitorEnabled: true },
    }),
    settleProbe("hasWork", () => hasVoipmonitorWork(), false),
    settleProbe("parked", countParkedVoipmonitor, 0),
    settleProbe("cdrEnrich", countUnenrichedCdrEnrich, 0),
  ]);

  const actorIds = [
    ...new Set(
      rows
        .map((r) => r.actorUserId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];

  const actors =
    actorIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, username: true, name: true },
        });

  const actorMap = new Map(
    actors.map((u) => [u.id, u.username ?? u.name ?? null] as const),
  );

  return {
    items: rows.map((row) =>
      toListItem(row, row.actorUserId ? (actorMap.get(row.actorUserId) ?? null) : null),
    ),
    total,
    page,
    pageSize,
    voipmonitorUnenrichedCount: Math.max(
      0,
      voipmonitorUnenrichedCount - voipmonitorParkedCount,
    ),
    voipmonitorEnabled: Boolean(voipmonitorSettings?.voipmonitorEnabled),
    voipmonitorHasWork,
    voipmonitorParkedCount,
    cdrEnrichUnenrichedCount,
  };
}

export type JobRunSummary = {
  lastSuccess: JobRunListItem | null;
  lastFailed: JobRunListItem | null;
  lastAny: JobRunListItem | null;
  runningCount: number;
};

/** Lightweight summary for dashboard / operational widgets. */
export async function getJobRunSummary(
  actionCode = "regs.poll",
): Promise<JobRunSummary> {
  const [lastSuccess, lastFailed, lastAny, runningCount] = await Promise.all([
    prisma.jobRun.findFirst({
      where: { actionCode, status: "success" },
      orderBy: { finishedAt: "desc" },
      include: { artifact: { select: { jobRunId: true } } },
    }),
    prisma.jobRun.findFirst({
      where: { actionCode, status: "failed" },
      orderBy: { finishedAt: "desc" },
      include: { artifact: { select: { jobRunId: true } } },
    }),
    prisma.jobRun.findFirst({
      where: { actionCode },
      orderBy: { startedAt: "desc" },
      include: { artifact: { select: { jobRunId: true } } },
    }),
    prisma.jobRun.count({
      where: { actionCode, status: "running" },
    }),
  ]);

  return {
    lastSuccess: lastSuccess ? toListItem(lastSuccess, null) : null,
    lastFailed: lastFailed ? toListItem(lastFailed, null) : null,
    lastAny: lastAny ? toListItem(lastAny, null) : null,
    runningCount,
  };
}
