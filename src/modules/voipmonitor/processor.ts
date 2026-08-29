import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { failJobRunIfStillRunning } from "@/modules/jobs/finalize";
import {
  compactEvidence,
  isMatchedStatus,
  nextAttemptAtForMiss,
} from "@/modules/voipmonitor/backoff";
import { candidateFromSatelRow } from "@/modules/voipmonitor/candidates";
import { VoipmonitorClient } from "@/modules/voipmonitor/client";
import { hasVoipmonitorWork } from "@/modules/voipmonitor/count";
import {
  JOB_BUDGET_MS,
  MAX_CANDIDATES_PER_HOUR,
  WRITE_CHUNK_SIZE,
} from "@/modules/voipmonitor/constants";
import { voipmonitorDueLinkWhere } from "@/modules/voipmonitor/queue-filter";
import { loadVoipmonitorRuntime } from "@/modules/voipmonitor/credentials";
import { auditLinkInvariants } from "@/modules/voipmonitor/invariants";
import {
  graceCutoffAt,
  laneCdrAtWhere,
  liveCutoffAt,
  type MatchLane,
} from "@/modules/voipmonitor/lanes";
import {
  collectLegCdrIds,
  parseVoipmonitorLegs,
} from "@/modules/voipmonitor/legs";
import { matchBucket } from "@/modules/voipmonitor/match";
import {
  probeBudgetForLane,
  shouldFetchAnotherArchiveHour,
} from "@/modules/voipmonitor/probe-budget";
import {
  STATUS_MATCHED_EXACT,
  STATUS_MATCHED_FALLBACK,
  STATUS_PENDING,
  type MatchBucketStats,
} from "@/modules/voipmonitor/types";

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
  skipped?: boolean;
  hoursProcessed?: number;
};

type HourMeta = {
  lane: MatchLane;
  hour: string;
  matched: number;
  written: number;
  candidates: number;
  invariantIssues: number;
  error?: string;
  probeBudget?: number;
  hourFetchCount?: number;
  probes?: number;
  matchedExact?: number;
  matchedFallback?: number;
  sliceSplits?: number;
  fetchMs?: number;
  matchMs?: number;
  writeMs?: number;
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

export async function pickNextHour(
  now: Date,
  lane: MatchLane,
): Promise<Date | null> {
  const graceCutoff = graceCutoffAt(now);
  const liveCutoff = liveCutoffAt(now);
  const lanePred =
    lane === "live"
      ? Prisma.sql`AND c."cdrAt" >= ${liveCutoff}`
      : Prisma.sql`AND c."cdrAt" < ${liveCutoff}`;
  const rows = await prisma.$queryRaw<Array<{ hour: Date }>>(Prisma.sql`
    SELECT date_trunc('hour', c."cdrAt") AS hour
    FROM cdr_records c
    LEFT JOIN cdr_voipmonitor_links l ON l.cdr_record_id = c.id
    WHERE c."cdrAt" IS NOT NULL
      AND c."importedAt" <= ${graceCutoff}
      AND (
        l.cdr_record_id IS NULL
        OR (
          l.voipmonitor_url = ''
          AND (l.next_attempt_at IS NULL OR l.next_attempt_at <= ${now})
        )
      )
      ${lanePred}
    ORDER BY date_trunc('hour', c."cdrAt") DESC
    LIMIT 1
  `);
  return rows[0]?.hour ?? null;
}

async function writeHourResults(
  now: Date,
  jobRunId: string,
  candidates: NonNullable<ReturnType<typeof candidateFromSatelRow>>[],
  results: Awaited<ReturnType<typeof matchBucket>>["results"],
  attempts: Map<string, number>,
): Promise<{ matched: number; written: number; invariantIssues: number }> {
  const issues = auditLinkInvariants(candidates, results);
  if (issues.length > 0) {
    logger.warn("voipmonitor.match.invariants", {
      jobRunId,
      issues: issues.slice(0, 20),
    });
  }
  const rows: Array<{
    cdrRecordId: string;
    voipmonitorUrl: string;
    voipmonitorCdrId: string;
    voipmonitorCallId: string;
    matchStatus: string;
    matchMethod: string;
    matchScore: number;
    matchedAt: Date | null;
    attemptCount: number;
    nextAttemptAt: Date | null;
    evidenceJson: string;
    voipmonitorLegs: string | null;
    updatedAt: Date;
  }> = [];
  let matched = 0;
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    const result = results[i];
    if (!result) continue;
    const attemptCount = (attempts.get(candidate.sourceRecordId) ?? 0) + 1;
    const matchedOk = isMatchedStatus(result.status);
    if (matchedOk) matched += 1;
    const evidenceJson = compactEvidence(result);
    rows.push({
      cdrRecordId: candidate.sourceRecordId,
      voipmonitorUrl: matchedOk ? result.cardUrl : "",
      voipmonitorCdrId: result.vm?.cdrId ?? "",
      voipmonitorCallId: result.vm?.callId ?? "",
      matchStatus: result.status || STATUS_PENDING,
      matchMethod: result.method,
      matchScore: result.score,
      matchedAt: result.matchedAt,
      attemptCount,
      nextAttemptAt: matchedOk
        ? null
        : nextAttemptAtForMiss(attemptCount, evidenceJson, now),
      evidenceJson,
      voipmonitorLegs: matchedOk ? JSON.stringify(result.legs) : null,
      updatedAt: now,
    });
  }
  for (let offset = 0; offset < rows.length; offset += WRITE_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + WRITE_CHUNK_SIZE);
    const tuples = chunk.map(
      (row) => Prisma.sql`(
        ${row.cdrRecordId},
        ${row.voipmonitorUrl},
        ${row.voipmonitorCdrId},
        ${row.voipmonitorCallId},
        ${row.matchStatus},
        ${row.matchMethod},
        ${row.matchScore},
        ${row.matchedAt},
        ${row.attemptCount},
        ${row.nextAttemptAt},
        ${row.evidenceJson},
        ${row.voipmonitorLegs === null ? Prisma.sql`NULL` : Prisma.sql`CAST(${row.voipmonitorLegs} AS JSONB)`},
        ${row.updatedAt}
      )`,
    );
    await prisma.$executeRaw`
      INSERT INTO cdr_voipmonitor_links (
        cdr_record_id,
        voipmonitor_url,
        voipmonitor_cdr_id,
        voipmonitor_call_id,
        match_status,
        match_method,
        match_score,
        matched_at,
        attempt_count,
        next_attempt_at,
        evidence_json,
        voipmonitor_legs,
        updated_at
      )
      VALUES ${Prisma.join(tuples)}
      ON CONFLICT (cdr_record_id) DO UPDATE SET
        voipmonitor_url = EXCLUDED.voipmonitor_url,
        voipmonitor_cdr_id = EXCLUDED.voipmonitor_cdr_id,
        voipmonitor_call_id = EXCLUDED.voipmonitor_call_id,
        match_status = EXCLUDED.match_status,
        match_method = EXCLUDED.match_method,
        match_score = EXCLUDED.match_score,
        matched_at = EXCLUDED.matched_at,
        attempt_count = EXCLUDED.attempt_count,
        next_attempt_at = EXCLUDED.next_attempt_at,
        evidence_json = EXCLUDED.evidence_json,
        voipmonitor_legs = EXCLUDED.voipmonitor_legs,
        updated_at = EXCLUDED.updated_at
    `;
  }
  return { matched, written: rows.length, invariantIssues: issues.length };
}

async function processHour(input: {
  lane: MatchLane;
  hour: Date;
  now: Date;
  jobRunId: string;
  client: VoipmonitorClient;
  guiUrl: string;
}): Promise<HourMeta> {
  const hourEnd = new Date(input.hour.getTime() + 60 * 60 * 1000);
  const cdrAt = laneCdrAtWhere(input.hour, hourEnd, input.lane, input.now);
  const rows = await prisma.cdrRecord.findMany({
    where: {
      importedAt: { lte: graceCutoffAt(input.now) },
      cdrAt,
      OR: [
        { voipmonitorLink: { is: null } },
        {
          voipmonitorLink: {
            is: voipmonitorDueLinkWhere(input.now),
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
  const existing =
    candidates.length === 0
      ? []
      : await prisma.cdrVoipmonitorLink.findMany({
          where: {
            cdrRecordId: { in: candidates.map((row) => row.sourceRecordId) },
          },
          select: { cdrRecordId: true, attemptCount: true },
        });
  const attempts = new Map(
    existing.map((row) => [row.cdrRecordId, row.attemptCount]),
  );
  let maxAttempt = 0;
  for (const count of attempts.values()) {
    if (count > maxAttempt) maxAttempt = count;
  }
  const probeBudget = probeBudgetForLane(input.lane, maxAttempt);
  const candidateIds = new Set(candidates.map((row) => row.sourceRecordId));
  const siblings =
    candidates.length === 0
      ? []
      : await prisma.cdrVoipmonitorLink.findMany({
          where: {
            voipmonitorUrl: { not: "" },
            cdrRecord: { cdrAt },
            NOT: { cdrRecordId: { in: [...candidateIds] } },
          },
          select: { voipmonitorCdrId: true, voipmonitorLegs: true },
        });
  const reservedCdrIds = new Set<string>();
  for (const link of siblings) {
    if (link.voipmonitorCdrId) reservedCdrIds.add(link.voipmonitorCdrId);
    for (const id of collectLegCdrIds(parseVoipmonitorLegs(link.voipmonitorLegs))) {
      reservedCdrIds.add(id);
    }
  }
  const { results, error, stats } = await matchBucket(
    {
      client: input.client,
      guiBase: input.guiUrl,
      probeBudget,
      reservedCdrIds,
    },
    candidates,
  );
  if (error) {
    return {
      lane: input.lane,
      hour: input.hour.toISOString(),
      matched: 0,
      written: 0,
      candidates: candidates.length,
      invariantIssues: 0,
      error: error.message,
      probeBudget,
      ...statsFields(stats),
    };
  }
  const writeStarted = Date.now();
  const written = await writeHourResults(
    input.now,
    input.jobRunId,
    candidates,
    results,
    attempts,
  );
  return {
    lane: input.lane,
    hour: input.hour.toISOString(),
    candidates: candidates.length,
    ...written,
    probeBudget,
    matchedExact: results.filter((row) => row.status === STATUS_MATCHED_EXACT)
      .length,
    matchedFallback: results.filter(
      (row) => row.status === STATUS_MATCHED_FALLBACK,
    ).length,
    writeMs: Date.now() - writeStarted,
    ...statsFields(stats),
  };
}

function statsFields(stats?: MatchBucketStats): Partial<HourMeta> {
  if (!stats) return {};
  return {
    hourFetchCount: stats.hourFetchCount,
    probes: stats.probes,
    sliceSplits: stats.sliceSplits,
    fetchMs: stats.fetchMs,
    matchMs: stats.matchMs,
  };
}

async function processLane(
  lane: MatchLane,
  jobRunId: string,
  client: VoipmonitorClient,
  guiUrl: string,
): Promise<HourMeta | null> {
  const now = new Date();
  if (!(await hasVoipmonitorWork(now, lane))) return null;
  const hour = await pickNextHour(now, lane);
  if (!hour) return null;
  return processHour({ lane, hour, now, jobRunId, client, guiUrl });
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
            reason: runtime.enabled ? "missing_credentials" : "disabled",
          } as Prisma.InputJsonValue,
        },
      });
      return {
        status: "success",
        jobRunId: jobRun.id,
        phonesParsed: 0,
        changesCount: 0,
        skipped: true,
        hoursProcessed: 0,
      };
    }

    const client = new VoipmonitorClient({
      apiUrl: runtime.apiUrl,
      user: runtime.user,
      password: runtime.password,
    });

    const hours: HourMeta[] = [];
    const deadline = startedAt.getTime() + JOB_BUDGET_MS;
    const live = await processLane("live", jobRun.id, client, runtime.guiUrl);
    if (live) hours.push(live);
    let fetchedArchive = false;
    while (
      shouldFetchAnotherArchiveHour(fetchedArchive, Date.now(), deadline)
    ) {
      const archive = await processLane(
        "archive",
        jobRun.id,
        client,
        runtime.guiUrl,
      );
      if (!archive) break;
      hours.push(archive);
      fetchedArchive = true;
    }

    const matched = hours.reduce((sum, hour) => sum + hour.matched, 0);
    const written = hours.reduce((sum, hour) => sum + hour.written, 0);
    const hourErrors = hours.filter((hour) => hour.error);
    const attempted = hours.filter(
      (hour) => hour.candidates > 0 || Boolean(hour.error),
    );
    const hoursProcessed = attempted.length;
    const anyProgress =
      written > 0 || attempted.some((hour) => !hour.error && hour.candidates > 0);
    const finishedAt = new Date();

    if (hoursProcessed === 0) {
      await prisma.jobRun.update({
        where: { id: jobRun.id },
        data: {
          status: "success",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          phonesParsed: 0,
          changesCount: 0,
          meta: { remainingHours: 0, hours: [] } as Prisma.InputJsonValue,
        },
      });
      return {
        status: "success",
        jobRunId: jobRun.id,
        phonesParsed: 0,
        changesCount: 0,
        hoursProcessed: 0,
      };
    }

    if (!anyProgress) {
      const message = hourErrors[0]?.error ?? "voipmonitor match failed";
      await prisma.jobRun.update({
        where: { id: jobRun.id },
        data: {
          status: "failed",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          phonesParsed: 0,
          changesCount: 0,
          errorMessage: message,
          meta: { hours } as Prisma.InputJsonValue,
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
        hoursProcessed,
      };
    }

    const errorMessage =
      hourErrors.length > 0
        ? hourErrors.map((hour) => `${hour.lane}: ${hour.error}`).join("; ")
        : undefined;

    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: {
        status: "success",
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        phonesParsed: matched,
        changesCount: written,
        errorMessage: errorMessage ?? null,
        meta: { hours, matched, written } as Prisma.InputJsonValue,
      },
    });

    await auditService.append({
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.VOIPMONITOR_MATCH_FINISH,
      entityType: "job_run",
      entityId: jobRun.id,
      meta: {
        trigger: input.trigger,
        status: "success",
        matched,
        written,
        hours: hours.map((hour) => hour.lane),
      },
    });

    logger.info("voipmonitor.match.finished", {
      jobRunId: jobRun.id,
      matched,
      written,
      hours: hours.map((hour) => ({
        lane: hour.lane,
        hour: hour.hour,
        error: hour.error ?? null,
      })),
    });

    return {
      status: "success",
      jobRunId: jobRun.id,
      phonesParsed: matched,
      changesCount: written,
      errorMessage,
      hoursProcessed,
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
      hoursProcessed: 0,
    };
  } finally {
    await failJobRunIfStillRunning(
      jobRun.id,
      startedAt,
      "Job ended without a terminal status",
    );
  }
}
