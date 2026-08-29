import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { trafficExportStartRateLimiter } from "@/lib/rate-limit";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import { parseMonthKey } from "@/modules/traffic/cdr-month";
import {
  createMonthExportJob,
  MonthExportActiveConflictError,
  startMonthExport,
  toJobView,
} from "@/modules/traffic/month-export-job";
import { runMonthExportPipeline } from "@/modules/traffic/month-export-pipeline";
import { pruneMonthExportArtifacts } from "@/modules/traffic/month-export-reclaim";

export const runtime = "nodejs";

function parseExportMonth(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const month = (body as { month?: unknown }).month;
  if (typeof month !== "string") return null;
  return parseMonthKey(month)?.key ?? null;
}

/**
 * POST /api/traffic/export — start a month CDR XLSX job.
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

  const limited = trafficExportStartRateLimiter.check(`traffic-export:${userId}`);
  if (!limited.allowed) {
    return NextResponse.json(
      {
        error: "Слишком много запусков выгрузки — подождите",
        code: "RATE_LIMITED",
        retryAfterSec: limited.retryAfterSec,
      },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  let json: unknown = null;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Некорректное тело запроса", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  const month = parseExportMonth(json);
  if (!month) {
    return NextResponse.json(
      { error: "Укажите month в формате YYYY-MM", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  await pruneMonthExportArtifacts();

  let job;
  try {
    job = createMonthExportJob({ actorUserId: userId, month });
  } catch (error) {
    if (error instanceof MonthExportActiveConflictError) {
      return NextResponse.json(
        { error: error.message, code: "CONFLICT" },
        { status: 409 },
      );
    }
    throw error;
  }

  startMonthExport(() => runMonthExportPipeline(job.id));
  return NextResponse.json({ job: toJobView(job) }, { status: 202 });
}
