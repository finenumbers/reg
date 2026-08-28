import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { failJobRunIfStillRunning } from "@/modules/jobs/finalize";
import { compactEvidence, isMatchedStatus, nextAttemptAt } from "@/modules/voipmonitor/backoff";
import { candidateFromSatelRow } from "@/modules/voipmonitor/candidates";
import { VoipmonitorClient } from "@/modules/voipmonitor/client";
import {
  GRACE_MS,
  JOB_BUDGET_MS,
  LIVE_PRIORITY_MS,
  MAX_CANDIDATES_PER_HOUR,
} from "@/modules/voipmonitor/constants";
import { loadVoipmonitorRuntime } from "@/modules/voipmonitor/credentials";
import { auditLinkInvariants } from "@/modules/voipmonitor/invariants";
import { matchBucket } from "@/modules/voipmonitor/match";
import { STATUS_PENDING } from "@/modules/voipmonitor/types";

export type VoipmonitorMatchInput = {
  trigger: "schedule" | "manual" | "test";
  actorUserId?: string;
};

export type VoipmonitorMatchResult = {
  status: "success" | "failed";
  jobRunId: string;
  phonesParsed: number;
  changesCount: number;
  errorMessage?: string;
};

const CANDIDATE_SELECT = {
  id: true,
  cdrId: true,
  cdrAt: true,
  billAni: true,
  billDnis: true,
  inAni: true,
  inDnis: true,
  outAni: true,
  outDnis: true,
  elapsedTime: true,
  connectTime: true,
  disconnectTime: true,
  remoteSrcSigAddress: true,
  remoteDstSigAddress: true,
  localSrcSigAddress: true,
  localDstSigAddress: true,
  outLegCallId: true,
  srcOutLegCallId: true,
  inLegCallId: true,
  srcInLegCallId: true,
  srcInLegConfId: true,
  confId: true,
} as const;

async function pickNextHour(
  now: Date,
): Promise<Date | null> {
  const graceCutoff = new Date(now.getTime() - GRACE_MS);
  const liveCutoff = new Date(now.getTime() - LIVE_PRIORITY_MS);
  const rows = await prisma.$queryRaw<Array<{ hour: Date }>>(Prisma.sql`
    SELECT date_trunc('hour', c."cdrAt") AS hour
    FROM cdr_records c
    LEFT JOIN cdr_voipmonitor_links l ON l.cdr_record_id = c.id
    WHERE c."cdrAt" IS NOT NULL
      AND c."cdrAt" <= ${graceCutoff}
      AND (l.cdr_record_id IS NULL OR l.voipmonitor_url = '')
      AND (l.next_attempt_at IS NULL OR l.next_attempt_at <= ${now})
    ORDER BY
      CASE WHEN c."cdrAt" >= ${liveCutoff} THEN 0 ELSE 1 END,
      date_trunc('hour', c."cdrAt") DESC
    LIMIT 1
  `);
  return rows[0]?.hour ?? null;
}

export async function processVoipmonitorMatch(
  input: VoipmonitorMatchInput,
): Promise<VoipmonitorMatchResult> {
  const startedAt = new Date();
  const jobRun = await prisma.jobRun.create({
    data: {
      actionCode: "voipmonitor.match",
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
          ? AUDIT_ACTIONS.VOIPMONITOR_MATCH_MANUAL
          : AUDIT_ACTIONS.VOIPMONITOR_MATCH_START,
      entityType: "job_run",
      entityId: jobRun.id,
      meta: { trigger: input.trigger, phase: "started" },
    });

    const runtime = await loadVoipmonitorRuntime();
    if (!runtime.ready) {
      const finishedAt = new Date();
      await prisma.jobRun.update({
        where: { id: jobRun.id },
        data: {
          status: "success",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          phonesParsed: 0,
          changesCount: 0,
          meta: {
            skipped: true,
            reason: runtime.enabled
              ? "missing_credentials"
              : "disabled",
          } as Prisma.InputJsonValue,
        },
      });
      return { status: "success", jobRunId: jobRun.id, phonesParsed: 0, changesCount: 0 };
    }

    const now = new Date();
    if (Date.now() - startedAt.getTime() > JOB_BUDGET_MS) {
      throw new Error("voipmonitor match budget exceeded before work");
    }

    const hour = await pickNextHour(now);
    if (!hour) {
      const finishedAt = new Date();
      await prisma.jobRun.update({
        where: { id: jobRun.id },
        data: {
          status: "success",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          phonesParsed: 0,
          changesCount: 0,
          meta: { remainingHours: 0 } as Prisma.InputJsonValue,
        },
      });
      return { status: "success", jobRunId: jobRun.id, phonesParsed: 0, changesCount: 0 };
    }

    const hourEnd = new Date(hour.getTime() + 60 * 60 * 1000);
    const graceCutoff = new Date(now.getTime() - GRACE_MS);
    const rows = await prisma.cdrRecord.findMany({
      where: {
        cdrAt: { gte: hour, lt: hourEnd, lte: graceCutoff },
        OR: [
          { voipmonitorLink: { is: null } },
          {
            voipmonitorLink: {
              is: {
                voipmonitorUrl: "",
                OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
              },
            },
          },
        ],
      },
      select: CANDIDATE_SELECT,
      orderBy: { cdrAt: "desc" },
      take: MAX_CANDIDATES_PER_HOUR,
    });

    const candidates = rows
      .map((row) => candidateFromSatelRow(row))
      .filter((row): row is NonNullable<typeof row> => row != null);

    const client = new VoipmonitorClient({
      apiUrl: runtime.apiUrl,
      user: runtime.user,
      password: runtime.password,
    });
    const { results, error } = await matchBucket(
      { client, guiBase: runtime.guiUrl },
      candidates,
    );
    if (error) {
      throw error;
    }

    const issues = auditLinkInvariants(candidates, results);
    if (issues.length > 0) {
      logger.warn("voipmonitor.match.invariants", {
        jobRunId: jobRun.id,
        issues: issues.slice(0, 20),
      });
    }

    let matched = 0;
    let written = 0;
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i]!;
      const result = results[i];
      if (!result) continue;
      const existing = await prisma.cdrVoipmonitorLink.findUnique({
        where: { cdrRecordId: candidate.sourceRecordId },
        select: { attemptCount: true },
      });
      const attemptCount = (existing?.attemptCount ?? 0) + 1;
      const matchedOk = isMatchedStatus(result.status);
      if (matchedOk) matched += 1;
      await prisma.cdrVoipmonitorLink.upsert({
        where: { cdrRecordId: candidate.sourceRecordId },
        create: {
          cdrRecordId: candidate.sourceRecordId,
          voipmonitorUrl: matchedOk ? result.cardUrl : "",
          voipmonitorCdrId: result.vm?.cdrId ?? "",
          voipmonitorCallId: result.vm?.callId ?? "",
          matchStatus: result.status || STATUS_PENDING,
          matchMethod: result.method,
          matchScore: result.score,
          matchedAt: result.matchedAt,
          attemptCount,
          nextAttemptAt: matchedOk ? null : nextAttemptAt(attemptCount, now),
          evidenceJson: compactEvidence(result),
        },
        update: {
          voipmonitorUrl: matchedOk ? result.cardUrl : "",
          voipmonitorCdrId: result.vm?.cdrId ?? "",
          voipmonitorCallId: result.vm?.callId ?? "",
          matchStatus: result.status || STATUS_PENDING,
          matchMethod: result.method,
          matchScore: result.score,
          matchedAt: result.matchedAt,
          attemptCount,
          nextAttemptAt: matchedOk ? null : nextAttemptAt(attemptCount, now),
          evidenceJson: compactEvidence(result),
        },
      });
      written += 1;
    }

    const finishedAt = new Date();
    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: {
        status: "success",
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        phonesParsed: matched,
        changesCount: written,
        meta: {
          hour: hour.toISOString(),
          matched,
          written,
          candidates: candidates.length,
          invariantIssues: issues.length,
        } as Prisma.InputJsonValue,
      },
    });

    await auditService.append({
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.VOIPMONITOR_MATCH_FINISH,
      entityType: "job_run",
      entityId: jobRun.id,
      meta: { trigger: input.trigger, status: "success", matched, written },
    });

    logger.info("voipmonitor.match.finished", {
      jobRunId: jobRun.id,
      hour: hour.toISOString(),
      matched,
      written,
    });

    return {
      status: "success",
      jobRunId: jobRun.id,
      phonesParsed: matched,
      changesCount: written,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const finishedAt = new Date();
    await prisma.jobRun.updateMany({
      where: { id: jobRun.id, status: "running" },
      data: {
        status: "failed",
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        errorMessage: message,
      },
    });
    logger.error("voipmonitor.match.failed", {
      jobRunId: jobRun.id,
      error: message,
    });
    return {
      status: "failed",
      jobRunId: jobRun.id,
      phonesParsed: 0,
      changesCount: 0,
      errorMessage: message,
    };
  } finally {
    await failJobRunIfStillRunning(
      jobRun.id,
      startedAt,
      "Job ended without a terminal status",
    );
  }
}
