import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { enrichStartRateLimiter } from "@/lib/rate-limit";
import { requireSessionUserId } from "@/modules/auth/session";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { getEnrichReadyFlags } from "@/modules/pstn/credentials";
import { ENRICH_MAX_UPLOAD_BYTES } from "@/modules/enrich/types";
import {
  createEnrichJob,
  EnrichActiveConflictError,
  findActiveEnrichJob,
} from "@/modules/enrich/jobs";
import {
  EnrichUploadError,
  streamMultipartFileToDisk,
} from "@/modules/enrich/multipart";
import { ensureJobDir, enrichSourcePath } from "@/modules/enrich/paths";
import { pruneEnrichArtifacts } from "@/modules/enrich/reclaim";
import { runEnrichPipeline } from "@/modules/enrich/pipeline";
import { startEnrichPipeline } from "@/modules/enrich/runtime";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/enrich — stream CSV to disk and start enrich job.
 */
export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  let userId: string;
  try {
    userId = requireSessionUserId(gate.ctx);
  } catch {
    return NextResponse.json(
      { error: "Forbidden", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  const limited = enrichStartRateLimiter.check(`enrich:${userId}`);
  if (!limited.allowed) {
    return NextResponse.json(
      {
        error: "Слишком много запусков обогащения — подождите",
        code: "RATE_LIMITED",
        retryAfterSec: limited.retryAfterSec,
      },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  const ready = await getEnrichReadyFlags();
  if (!ready.hasPstnApiKey || !ready.hasGeoipApiKey) {
    return NextResponse.json(
      {
        error:
          "Сначала сохраните API-ключи PSTN и GeoIP в Настройках",
        code: "PRECONDITION_FAILED",
        hasPstnApiKey: ready.hasPstnApiKey,
        hasGeoipApiKey: ready.hasGeoipApiKey,
      },
      { status: 412 },
    );
  }

  const active = await findActiveEnrichJob();
  if (active) {
    return NextResponse.json(
      {
        error: "Уже выполняется другое обогащение",
        code: "CONFLICT",
        jobId: active.id,
      },
      { status: 409 },
    );
  }

  await pruneEnrichArtifacts();

  let jobId: string;
  try {
    jobId = await createEnrichJob({
      actorUserId: userId,
      sourceFilename: "cdr",
    });
  } catch (error) {
    if (error instanceof EnrichActiveConflictError) {
      const again = await findActiveEnrichJob();
      return NextResponse.json(
        {
          error: error.message,
          code: "CONFLICT",
          jobId: again?.id ?? null,
        },
        { status: 409 },
      );
    }
    throw error;
  }
  ensureJobDir(jobId);

  try {
    const uploaded = await streamMultipartFileToDisk(
      request,
      enrichSourcePath(jobId),
      ENRICH_MAX_UPLOAD_BYTES,
    );
    const { prisma } = await import("@/lib/db");
    await prisma.enrichJob.update({
      where: { id: jobId },
      data: { sourceFilename: uploaded.filename },
    });

    const ip = await getRequestIp();
    await auditService.append({
      actorUserId: userId,
      action: AUDIT_ACTIONS.ENRICH_START,
      entityType: "enrich_job",
      entityId: jobId,
      ip,
      meta: { sourceFilename: uploaded.filename, bytes: uploaded.bytes },
    });

    const started = startEnrichPipeline(() =>
      runEnrichPipeline({
        jobId,
        actorUserId: userId,
        sourceFilename: uploaded.filename,
        ip,
      }),
    );
    if (!started) {
      const { prisma } = await import("@/lib/db");
      await prisma.enrichJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          finishedAt: new Date(),
          errorMessage: "Уже выполняется другое обогащение",
        },
      });
      return NextResponse.json(
        {
          error: "Уже выполняется другое обогащение",
          code: "CONFLICT",
          jobId,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ jobId }, { status: 202 });
  } catch (error) {
    const { prisma } = await import("@/lib/db");
    await prisma.enrichJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage:
          error instanceof Error ? error.message : "Ошибка загрузки",
      },
    });
    if (error instanceof EnrichUploadError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    throw error;
  }
}
