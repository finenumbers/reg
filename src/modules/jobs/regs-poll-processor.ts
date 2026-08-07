/**
 * regs.poll job processor — remote exec → parse → apply → artifacts/audit.
 *
 * Fail / timeout / exit≠0 / empty stdout → mark job failed and do NOT touch reg_current.
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
import {
  applyRegistrationPoll,
  type ApplyRegistrationsResult,
} from "@/modules/registrations/apply";
import { parseRegsStdout } from "@/modules/registrations/parser";

export type RegsPollProcessorInput = {
  trigger: JobTrigger;
  actorUserId?: string | null;
};

export type RegsPollProcessorResult = {
  jobRunId: string;
  status: "success" | "failed";
  errorMessage: string | null;
  phonesParsed: number;
  linesBad: number;
  changesCount: number;
  exitCode: number | null;
};

export type RegsPollProcessorDeps = {
  execute: RemoteExecutionService["execute"];
  apply: typeof applyRegistrationPoll;
};

const DEFAULT_DEPS: RegsPollProcessorDeps = {
  execute: (req) => remoteExecutionService.execute(req),
  apply: applyRegistrationPoll,
};

const DEFAULT_ARTIFACT_MAX_BYTES = 50_000_000;

/**
 * Sanitize stderr for inclusion in job errorMessage (UI/ops).
 * Strips ANSI/control chars; prefers a permission/sudo/mysql line when present.
 */
export function sanitizeStderrSnippet(
  stderr: string,
  maxLen = 240,
): string {
  const strip = (s: string) =>
    s
      .replace(/\u001b\[[0-9;]*m/g, "")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .trim();

  const lines = stderr
    .split(/\r?\n/)
    .map(strip)
    .filter((line) => line.length > 0);

  if (lines.length === 0) return "";

  const preferred =
    lines.find((line) =>
      /permission denied|sudo:|mysql:|access-db\.conf/i.test(line),
    ) ?? lines[0]!;

  if (preferred.length <= maxLen) return preferred;
  return `${preferred.slice(0, Math.max(0, maxLen - 1))}…`;
}

function emptyStdoutErrorMessage(stderr: string): string {
  const snippet = sanitizeStderrSnippet(stderr);
  const base =
    "Удалённый скрипт вернул пустой stdout — текущее состояние не обновлено";
  if (snippet) {
    return `${base}. stderr: ${snippet}`;
  }
  return `${base}. Проверьте NOPASSWD sudoers на /opt/scripts/check_regs.sh (sudo -n без пароля).`;
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

/**
 * Best-effort artifact retention for regs.poll runs.
 * Never throws — cleanup failures are logged only.
 */
async function pruneArtifacts(limits: {
  retentionDays: number;
  keepLastRuns: number;
}): Promise<void> {
  try {
    const cutoff = new Date(
      Date.now() - limits.retentionDays * 24 * 60 * 60 * 1000,
    );
    const keep = await prisma.jobRun.findMany({
      where: { actionCode: "regs.poll" },
      orderBy: { startedAt: "desc" },
      take: limits.keepLastRuns,
      select: { id: true },
    });
    const keepIds = keep.map((r) => r.id);

    // Keep if (in last N) OR (within retention window). Delete otherwise.
    await prisma.jobRunArtifact.deleteMany({
      where: {
        jobRun: {
          actionCode: "regs.poll",
          startedAt: { lt: cutoff },
          ...(keepIds.length > 0 ? { id: { notIn: keepIds } } : {}),
        },
      },
    });
  } catch (error) {
    logger.warn("regs.poll.artifact_prune_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function processRegsPoll(
  input: RegsPollProcessorInput,
  deps: RegsPollProcessorDeps = DEFAULT_DEPS,
): Promise<RegsPollProcessorResult> {
  const startedAt = new Date();

  const jobRun = await prisma.jobRun.create({
    data: {
      actionCode: "regs.poll",
      trigger: input.trigger,
      status: "running",
      startedAt,
      actorUserId: input.actorUserId ?? null,
    },
  });

  await auditService.append({
    actorUserId: input.actorUserId,
    action:
      input.trigger === "manual"
        ? AUDIT_ACTIONS.REGS_POLL_MANUAL
        : AUDIT_ACTIONS.REGS_POLL_START,
    entityType: "job_run",
    entityId: jobRun.id,
    meta: {
      trigger: input.trigger,
      actionCode: "regs.poll",
      phase: "started",
    },
  });

  logger.info("regs.poll.started", {
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
      linesBad?: number;
    } = {},
  ): Promise<RegsPollProcessorResult> => {
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
        linesBad: extras.linesBad ?? 0,
        changesCount: 0,
      },
    });

    await auditService.append({
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.REGS_POLL_FINISH,
      entityType: "job_run",
      entityId: jobRun.id,
      meta: {
        trigger: input.trigger,
        status: "failed",
        errorMessage,
        exitCode: extras.exitCode ?? null,
      },
    });

    logger.warn("regs.poll.failed", {
      jobRunId: jobRun.id,
      errorMessage,
      exitCode: extras.exitCode ?? null,
    });

    return {
      jobRunId: jobRun.id,
      status: "failed",
      errorMessage,
      phonesParsed: extras.phonesParsed ?? 0,
      linesBad: extras.linesBad ?? 0,
      changesCount: 0,
      exitCode: extras.exitCode ?? null,
    };
  };

  let execResult;
  try {
    execResult = await deps.execute({
      actionCode: "regs.poll",
      timeoutMs: 60_000,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Remote execution failed";
    // Never include key material — messages from our layers are already safe.
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
    return fail(
      `Remote script exited with code ${execResult.exitCode ?? "unknown"}`,
      {
        exitCode: execResult.exitCode,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
      },
    );
  }

  if (!execResult.stdout.trim()) {
    return fail(emptyStdoutErrorMessage(execResult.stderr), {
      exitCode: execResult.exitCode,
      stdout: execResult.stdout,
      stderr: execResult.stderr,
    });
  }

  const parsed = parseRegsStdout(execResult.stdout);

  if (parsed.linesBad > 0) {
    logger.warn("regs.poll.parser_anomalies", {
      jobRunId: jobRun.id,
      linesBad: parsed.linesBad,
      sample: parsed.badLines.slice(0, 5),
    });
    return fail(
      `regs.poll отклонён: ${parsed.linesBad} некорректных строк — текущее состояние не обновлено`,
      {
        exitCode: execResult.exitCode,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        phonesParsed: parsed.rows.length,
        linesBad: parsed.linesBad,
      },
    );
  }

  if (parsed.linesTotal > 0 && parsed.rows.length === 0) {
    return fail(
      "regs.poll отклонён: нет валидных строк при непустом stdout — текущее состояние не обновлено",
      {
        exitCode: execResult.exitCode,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        phonesParsed: 0,
        linesBad: parsed.linesBad,
      },
    );
  }

  let applyResult: ApplyRegistrationsResult;
  try {
    applyResult = await deps.apply(parsed.rows, jobRun.id, new Date());
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to apply registration updates",
      {
        exitCode: execResult.exitCode,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        phonesParsed: parsed.rows.length,
        linesBad: parsed.linesBad,
      },
    );
  }

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

  const finishedAt = new Date();
  await prisma.jobRun.update({
    where: { id: jobRun.id },
    data: {
      status: "success",
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      errorMessage: null,
      exitCode: execResult.exitCode,
      phonesParsed: parsed.rows.length,
      linesBad: parsed.linesBad,
      changesCount: applyResult.changesCount,
      meta: {
        duplicatePhones: parsed.duplicatePhones,
        linesTotal: parsed.linesTotal,
        durationMsRemote: execResult.durationMs,
        removed: applyResult.removed,
      },
    },
  });

  await pruneArtifacts(limits);

  await auditService.append({
    actorUserId: input.actorUserId,
    action: AUDIT_ACTIONS.REGS_POLL_FINISH,
    entityType: "job_run",
    entityId: jobRun.id,
    meta: {
      trigger: input.trigger,
      status: "success",
      phonesParsed: parsed.rows.length,
      linesBad: parsed.linesBad,
      changesCount: applyResult.changesCount,
      exitCode: execResult.exitCode,
    },
  });

  logger.info("regs.poll.finished", {
    jobRunId: jobRun.id,
    phonesParsed: parsed.rows.length,
    linesBad: parsed.linesBad,
    changesCount: applyResult.changesCount,
  });

  return {
    jobRunId: jobRun.id,
    status: "success",
    errorMessage: null,
    phonesParsed: parsed.rows.length,
    linesBad: parsed.linesBad,
    changesCount: applyResult.changesCount,
    exitCode: execResult.exitCode,
  };
}
