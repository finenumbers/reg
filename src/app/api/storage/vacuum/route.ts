import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { storageVacuumRateLimiter } from "@/lib/rate-limit";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import { jobRuntime } from "@/modules/jobs/runtime";
import { DATABASE_VACUUM_CONFIRM } from "@/modules/storage/vacuum/sql";

export const runtime = "nodejs";

function conflictMessage(reason: string | undefined): string {
  if (!reason) return "Сжатие уже выполняется";
  if (reason.includes("db.vacuum")) return "Сжатие уже выполняется";
  if (reason.includes("cdr.import")) return "Дождитесь окончания импорта CDR";
  if (reason.includes("cdr.purge")) return "Дождитесь окончания удаления месяца";
  if (reason.includes("month export")) return "Дождитесь окончания выгрузки";
  if (reason.includes("voipmonitor")) return "Дождитесь окончания сопоставления VoIPmonitor";
  if (reason.includes("sides")) return "Дождитесь окончания обновления описаний";
  if (reason.includes("tariff")) return "Дождитесь окончания пересчёта тарифов";
  return "Сжатие сейчас недоступно";
}

/**
 * POST /api/storage/vacuum — VACUUM FULL the two CDR relations.
 * Returns as soon as the job is queued.
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

  const limited = storageVacuumRateLimiter.check(`storage-vacuum:${userId}`);
  if (!limited.allowed) {
    return NextResponse.json(
      {
        error: "Слишком много запусков сжатия — подождите",
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
  const confirm =
    json && typeof json === "object"
      ? (json as { confirm?: unknown }).confirm
      : null;
  if (confirm !== DATABASE_VACUUM_CONFIRM) {
    return NextResponse.json(
      { error: `Введите ${DATABASE_VACUUM_CONFIRM}`, code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const result = await jobRuntime.enqueue({
    actionCode: "db.vacuum",
    trigger: "manual",
    actorUserId: userId,
  });
  if (!result.accepted) {
    return NextResponse.json(
      {
        error: conflictMessage(result.reason),
        code: "CONFLICT",
        reason: result.reason,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ accepted: true }, { status: 202 });
}
