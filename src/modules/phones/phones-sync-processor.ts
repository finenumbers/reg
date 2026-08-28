/**
 * phones.sync job processor — remote exec → parse JSON → replace snapshot.
 *
 * Fail / timeout / exit≠0 / invalid JSON → mark job failed and do NOT touch tables.
 */

import type { JobTrigger } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { truncateUtf8 } from "@/lib/utf8-truncate";
import {
  remoteExecutionService,
  type RemoteExecutionService,
} from "@/modules/actions/execution";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { applyPhonesSnapshot } from "@/modules/phones/apply";
import { parsePhonesStdout } from "@/modules/phones/parser";
import { sanitizeStderrSnippet } from "@/modules/jobs/regs-poll-processor";
import { failJobRunIfStillRunning } from "@/modules/jobs/finalize";

export type PhonesSyncProcessorInput = {
  trigger: JobTrigger;
  actorUserId?: string | null;
};

export type PhonesSyncProcessorResult = {
  jobRunId: string;
  status: "success" | "failed";
  errorMessage: string | null;
  phonesParsed: number;
  endpointCount: number;
  gatewayCount: number;
  exitCode: number | null;
};

export type PhonesSyncProcessorDeps = {
  execute: RemoteExecutionService["execute"];
  apply: typeof applyPhonesSnapshot;
};

const DEFAULT_DEPS: PhonesSyncProcessorDeps = {
  execute: (req) => remoteExecutionService.execute(req),
  apply: applyPhonesSnapshot,
};

const DEFAULT_ARTIFACT_MAX_BYTES = 50_000_000;

function emptyStdoutErrorMessage(stderr: string): string {
  const snippet = sanitizeStderrSnippet(stderr);
  const base =
    "Удалённый export.py вернул пустой stdout — таблица номеров не обновлена";
  if (snippet) {
    return `${base}. stderr: ${snippet}`;
  }
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
      where: { actionCode: "phones.sync" },
      orderBy: { startedAt: "desc" },
      take: limits.keepLastRuns,
      select: { id: true },
    });
    const keepIds = keep.map((r) => r.id);

    await prisma.jobRunArtifact.deleteMany({
      where: {
        jobRun: {
          actionCode: "phones.sync",
          startedAt: { lt: cutoff },
          ...(keepIds.length > 0 ? { id: { notIn: keepIds } } : {}),
        },
      },
    });
  } catch (error) {
    logger.warn("phones.sync.artifact_prune_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function processPhonesSync(
  input: PhonesSyncProcessorInput,
  deps: PhonesSyncProcessorDeps = DEFAULT_DEPS,
): Promise<PhonesSyncProcessorResult> {
  const startedAt = new Date();

  const jobRun = await prisma.jobRun.create({
    data: {
      actionCode: "phones.sync",
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
        ? AUDIT_ACTIONS.PHONES_SYNC_MANUAL
        : AUDIT_ACTIONS.PHONES_SYNC_START,
    entityType: "job_run",
    entityId: jobRun.id,
    meta: {
      trigger: input.trigger,
      actionCode: "phones.sync",
      phase: "started",
    },
  });

  logger.info("phones.sync.started", {
    jobRunId: jobRun.id,
    trigger: input.trigger,
  });

  const fail = async (
    errorMessage: string,
    extras: {
      exitCode?: number | null;
      stdout?: string;
      stderr?: string;
      phonesParsed?: number;
    } = {},
  ): Promise<PhonesSyncProcessorResult> => {
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
        phonesParsed: extras.phonesParsed ?? 0,
        linesBad: 0,
        changesCount: 0,
      },
    });

    await auditService.append({
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.PHONES_SYNC_FINISH,
      entityType: "job_run",
      entityId: jobRun.id,
      meta: {
        trigger: input.trigger,
        status: "failed",
        errorMessage,
        exitCode: extras.exitCode ?? null,
      },
    });

    logger.warn("phones.sync.failed", {
      jobRunId: jobRun.id,
      errorMessage,
      exitCode: extras.exitCode ?? null,
    });

    return {
      jobRunId: jobRun.id,
      status: "failed",
      errorMessage,
      phonesParsed: extras.phonesParsed ?? 0,
      endpointCount: 0,
      gatewayCount: 0,
      exitCode: extras.exitCode ?? null,
    };
  };

  let execResult;
  try {
    execResult = await deps.execute({
      actionCode: "phones.sync",
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

  if (!execResult.stdout.trim()) {
    return fail(emptyStdoutErrorMessage(execResult.stderr), {
      exitCode: execResult.exitCode,
      stdout: execResult.stdout,
      stderr: execResult.stderr,
    });
  }

  let parsed;
  try {
    parsed = parsePhonesStdout(execResult.stdout);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to parse phones JSON",
      {
        exitCode: execResult.exitCode,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
      },
    );
  }

  const totalRows = parsed.endpoints.length + parsed.gateways.length;

  if (totalRows === 0) {
    const [endpointCount, gatewayCount, state] = await Promise.all([
      prisma.phoneEndpoint.count(),
      prisma.phoneGateway.count(),
      prisma.phoneImportState.findUnique({ where: { id: 1 } }),
    ]);
    const previous =
      endpointCount +
      gatewayCount +
      (state?.endpointCount ?? 0) +
      (state?.gatewayCount ?? 0);
    if (previous > 0) {
      return fail(
        "Пустой снимок отклонён — отказ от wipe непустой таблицы номеров",
        {
          exitCode: execResult.exitCode,
          stdout: execResult.stdout,
          stderr: execResult.stderr,
          phonesParsed: 0,
        },
      );
    }
  }

  let applyResult;
  try {
    applyResult = await deps.apply(parsed, jobRun.id, new Date());
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to apply phones snapshot",
      {
        exitCode: execResult.exitCode,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        phonesParsed: totalRows,
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
        phonesParsed: totalRows,
        linesBad: 0,
        changesCount: totalRows,
        meta: {
          endpointCount: applyResult.endpointCount,
          gatewayCount: applyResult.gatewayCount,
          version: parsed.version,
          durationMsRemote: execResult.durationMs,
        },
      },
    });

    await pruneArtifacts(limits);

    await auditService.append({
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.PHONES_SYNC_FINISH,
      entityType: "job_run",
      entityId: jobRun.id,
      meta: {
        trigger: input.trigger,
        status: "success",
        endpointCount: applyResult.endpointCount,
        gatewayCount: applyResult.gatewayCount,
        phonesParsed: totalRows,
        exitCode: execResult.exitCode,
      },
    });
  } catch (error) {
    logger.warn("phones.sync.post_apply_finalize_failed", {
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
          phonesParsed: totalRows,
          linesBad: 0,
          changesCount: totalRows,
          meta: {
            endpointCount: applyResult.endpointCount,
            gatewayCount: applyResult.gatewayCount,
            version: parsed.version,
            durationMsRemote: execResult.durationMs,
          },
        },
      });
    } catch (markError) {
      logger.error("phones.sync.success_mark_failed", {
        jobRunId: jobRun.id,
        error: markError instanceof Error ? markError.message : String(markError),
      });
    }
  }

  logger.info("phones.sync.finished", {
    jobRunId: jobRun.id,
    endpointCount: applyResult.endpointCount,
    gatewayCount: applyResult.gatewayCount,
  });

  return {
    jobRunId: jobRun.id,
    status: "success",
    errorMessage: null,
    phonesParsed: totalRows,
    endpointCount: applyResult.endpointCount,
    gatewayCount: applyResult.gatewayCount,
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
