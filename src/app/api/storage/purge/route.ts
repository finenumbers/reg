import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { storagePurgeRateLimiter } from "@/lib/rate-limit";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import { jobRuntime } from "@/modules/jobs/runtime";
import { parseMonthKey } from "@/modules/traffic/cdr-month";
import { resolveDeletableMonthKey } from "@/modules/traffic/purge/processor";

export const runtime = "nodejs";

/**
 * POST /api/storage/purge — delete the oldest complete CDR month.
 */
export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireApiPermission("settings:write");
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

  const limited = storagePurgeRateLimiter.check(`storage-purge:${userId}`);
  if (!limited.allowed) {
    return NextResponse.json(
      {
        error: "Слишком много запусков удаления — подождите",
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
  const raw =
    json && typeof json === "object"
      ? (json as { month?: unknown }).month
      : null;
  const month = typeof raw === "string" ? parseMonthKey(raw) : null;
  if (!month) {
    return NextResponse.json(
      { error: "Укажите month в формате YYYY-MM", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const deletable = await resolveDeletableMonthKey();
  if (!deletable || deletable !== month.key) {
    return NextResponse.json(
      {
        error: deletable
          ? `Удалить можно только самый старый полный месяц (${deletable})`
          : "Нет полного месяца для удаления",
        code: "BAD_REQUEST",
      },
      { status: 400 },
    );
  }

  const result = await jobRuntime.enqueue({
    actionCode: "cdr.purge.month",
    trigger: "manual",
    actorUserId: userId,
    month: month.key,
  });
  if (!result.accepted) {
    return NextResponse.json(
      {
        error:
          result.reason === "anti-overlap: cdr.import in flight"
            ? "Дождитесь окончания импорта CDR"
            : "Удаление уже выполняется",
        code: "CONFLICT",
        reason: result.reason,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ accepted: true, month: month.key }, { status: 202 });
}
