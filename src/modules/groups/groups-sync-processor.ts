/**
 * groups.sync — remote export.py → parse groups[] → replace routing_groups.
 * Does not touch phone_endpoints / phone_gateways.
 */

import type { JobTrigger } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { stripAnsi } from "@/lib/strip-ansi";
import { truncateUtf8 } from "@/lib/utf8-truncate";
import {
  remoteExecutionService,
  type RemoteExecutionService,
} from "@/modules/actions/execution";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { applyGroupsSnapshot } from "@/modules/groups/apply";
import { parseGroupsStdout } from "@/modules/groups/parse";
import { sanitizeStderrSnippet } from "@/modules/jobs/regs-poll-processor";
import { failJobRunIfStillRunning } from "@/modules/jobs/finalize";

export type GroupsSyncProcessorInput = {
  trigger: JobTrigger;
  actorUserId?: string | null;
};

export type GroupsSyncProcessorResult = {
  jobRunId: string;
  status: "success" | "failed";
  errorMessage: string | null;
  groupCount: number;
  exitCode: number | null;
};

export type GroupsSyncProcessorDeps = {
  execute: RemoteExecutionService["execute"];
  apply: typeof applyGroupsSnapshot;
};

const DEFAULT_DEPS: GroupsSyncProcessorDeps = {
  execute: (req) => remoteExecutionService.execute(req),
  apply: applyGroupsSnapshot,
};

const DEFAULT_ARTIFACT_MAX_BYTES = 50_000_000;

function emptyStdoutErrorMessage(stderr: string): string {
  const snippet = sanitizeStderrSnippet(stderr);
  const base =
    "Удалённый export.py вернул пустой stdout — справочник групп не обновлён";
  if (snippet) return `${base}. stderr: ${snippet}`;
  return `${base}. Проверьте NOPASSWD sudoers на /opt/scripts/export.py.`;
}

function remoteExitErrorMessage(
  exitCode: number | null | undefined,
  stderr: string,
): string {
  const code = exitCode ?? "unknown";
  const snippet = sanitizeStderrSnippet(stderr);
  const base = `Remote script exited with code ${code}`;
  if (snippet) return `${base}. stderr: ${snippet}`;
  return base;
}

async function loadArtifactLimits(): Promise<{
  maxBytes: number;
  retentionDays: number;
  keepLastRuns: number;
}> {
  const settings = await prisma.appSetting.findUnique({ where: { id: 1 } });
  return {
    maxBytes: settings?.artifactMaxBytes ?? DEFAULT_ARTIFACT_MAX_BYTES,
    retentionDays: settings?.artifactRetentionDays ?? 14,
    keepLastRuns: settings?.artifactKeepLastRuns ?? 50,
  };
}

async function pruneArtifacts(limits: {
  retentionDays: number;
  keepLastRuns: number;
}): Promise<void> {
  try {
    const cutoff = new Date(
      Date.now() - limits.retentionDays * 24 * 60 * 60 * 1000,
    );
    const keep = await prisma.jobRun.findMany({
      where: { actionCode: "groups.sync" },
      orderBy: { startedAt: "desc" },
      take: limits.keepLastRuns,
      select: { id: true },
    });
    const keepIds = keep.map((r) => r.id);
    await prisma.jobRunArtifact.deleteMany({
      where: {
        jobRun: {
          actionCode: "groups.sync",
          startedAt: { lt: cutoff },
          ...(keepIds.length > 0 ? { id: { notIn: keepIds } } : {}),
        },
      },
    });
  } catch (error) {
    logger.warn("groups.sync.artifact_prune_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function processGroupsSync(
  input: GroupsSyncProcessorInput,
  deps: GroupsSyncProcessorDeps = DEFAULT_DEPS,
): Promise<GroupsSyncProcessorResult> {
  const startedAt = new Date();

  const jobRun = await prisma.jobRun.create({
    data: {
      actionCode: "groups.sync",
      trigger: input.trigger,
      status: "running",
      startedAt,
      actorUserId: input.actorUserId ?? null,
    },
  });

  try {
  await auditService.append({
    actorUserId: input.actorUserId,
    action:
      input.trigger === "manual"
        ? AUDIT_ACTIONS.GROUPS_SYNC_MANUAL
        : AUDIT_ACTIONS.GROUPS_SYNC_START,
    entityType: "job_run",
    entityId: jobRun.id,
    meta: {
      trigger: input.trigger,
      actionCode: "groups.sync",
      phase: "started",
    },
  });

  logger.info("groups.sync.started", {
    jobRunId: jobRun.id,
    trigger: input.trigger,
  });

  const fail = async (
    errorMessage: string,
    extras: {
      exitCode?: number | null;
      stdout?: string;
      stderr?: string;
      groupCount?: number;
    } = {},
  ): Promise<GroupsSyncProcessorResult> => {
    const finishedAt = new Date();
    const limits = await loadArtifactLimits();

    if (extras.stdout !== undefined || extras.stderr !== undefined) {
      await prisma.jobRunArtifact.upsert({
        where: { jobRunId: jobRun.id },
        create: {
          jobRunId: jobRun.id,
          stdout: truncateUtf8(extras.stdout ?? "", limits.maxBytes),
          stderr: truncateUtf8(extras.stderr ?? "", limits.maxBytes),
        },
        update: {
          stdout: truncateUtf8(extras.stdout ?? "", limits.maxBytes),
          stderr: truncateUtf8(extras.stderr ?? "", limits.maxBytes),
        },
      });
    }

    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: {
        status: "failed",
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        errorMessage,
        exitCode: extras.exitCode ?? null,
        phonesParsed: extras.groupCount ?? 0,
        linesBad: 0,
        changesCount: 0,
      },
    });

    await auditService.append({
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.GROUPS_SYNC_FINISH,
      entityType: "job_run",
      entityId: jobRun.id,
      meta: {
        trigger: input.trigger,
        status: "failed",
        errorMessage,
        exitCode: extras.exitCode ?? null,
      },
    });

    logger.warn("groups.sync.failed", {
      jobRunId: jobRun.id,
      errorMessage,
    });

    return {
      jobRunId: jobRun.id,
      status: "failed",
      errorMessage,
      groupCount: extras.groupCount ?? 0,
      exitCode: extras.exitCode ?? null,
    };
  };

  let execResult;
  try {
    execResult = await deps.execute({
      actionCode: "groups.sync",
      timeoutMs: 120_000,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Remote execution failed";
    return fail(message);
  }

  if (execResult.timedOut) {
    return fail("SSH exec timed out", {
      exitCode: execResult.exitCode,
      stdout: execResult.stdout,
      stderr: execResult.stderr,
    });
  }

  if (execResult.exitCode !== 0) {
    return fail(remoteExitErrorMessage(execResult.exitCode, execResult.stderr), {
      exitCode: execResult.exitCode,
      stdout: execResult.stdout,
      stderr: execResult.stderr,
    });
  }

  if (!execResult.stdout.trim() || !stripAnsi(execResult.stdout).trim()) {
    return fail(emptyStdoutErrorMessage(execResult.stderr), {
      exitCode: execResult.exitCode,
      stdout: execResult.stdout,
      stderr: execResult.stderr,
    });
  }

  let parsed;
  try {
    parsed = parseGroupsStdout(execResult.stdout);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to parse groups JSON",
      {
        exitCode: execResult.exitCode,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
      },
    );
  }

  if (parsed.groups.length === 0) {
    const liveCount = await prisma.routingGroup.count();
    if (liveCount > 0) {
      return fail(
        "Пустой справочник групп отклонён — отказ от wipe непустой таблицы",
        {
          exitCode: execResult.exitCode,
          stdout: execResult.stdout,
          stderr: execResult.stderr,
          groupCount: 0,
        },
      );
    }
  }

  let applyResult;
  try {
    applyResult = await deps.apply(parsed, jobRun.id, new Date());
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to apply groups snapshot",
      {
        exitCode: execResult.exitCode,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        groupCount: parsed.groups.length,
      },
    );
  }

  const finishedAt = new Date();
  try {
    const limits = await loadArtifactLimits();
    await prisma.jobRunArtifact.upsert({
      where: { jobRunId: jobRun.id },
      create: {
        jobRunId: jobRun.id,
        stdout: truncateUtf8(execResult.stdout, limits.maxBytes),
        stderr: truncateUtf8(execResult.stderr, limits.maxBytes),
      },
      update: {
        stdout: truncateUtf8(execResult.stdout, limits.maxBytes),
        stderr: truncateUtf8(execResult.stderr, limits.maxBytes),
      },
    });

    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: {
        status: "success",
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        errorMessage: null,
        exitCode: execResult.exitCode,
        phonesParsed: applyResult.groupCount,
        linesBad: 0,
        changesCount: applyResult.groupCount,
        meta: {
          groupCount: applyResult.groupCount,
          version: parsed.version,
          durationMsRemote: execResult.durationMs,
        },
      },
    });

    await pruneArtifacts(limits);

    await auditService.append({
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.GROUPS_SYNC_FINISH,
      entityType: "job_run",
      entityId: jobRun.id,
      meta: {
        trigger: input.trigger,
        status: "success",
        groupCount: applyResult.groupCount,
        exitCode: execResult.exitCode,
      },
    });
  } catch (error) {
    logger.warn("groups.sync.post_apply_finalize_failed", {
      jobRunId: jobRun.id,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      await prisma.jobRun.update({
        where: { id: jobRun.id },
        data: {
          status: "success",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          errorMessage: null,
          exitCode: execResult.exitCode,
          phonesParsed: applyResult.groupCount,
          linesBad: 0,
          changesCount: applyResult.groupCount,
        },
      });
    } catch (markError) {
      logger.error("groups.sync.success_mark_failed", {
        jobRunId: jobRun.id,
        error: markError instanceof Error ? markError.message : String(markError),
      });
    }
  }

  logger.info("groups.sync.finished", {
    jobRunId: jobRun.id,
    groupCount: applyResult.groupCount,
  });

  return {
    jobRunId: jobRun.id,
    status: "success",
    errorMessage: null,
    groupCount: applyResult.groupCount,
    exitCode: execResult.exitCode,
  };
  } finally {
    await failJobRunIfStillRunning(
      jobRun.id,
      startedAt,
      "Job ended without a terminal status",
    );
  }
}
