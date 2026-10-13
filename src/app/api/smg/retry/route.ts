import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { pollRateLimiter } from "@/lib/rate-limit";
import { jobRuntime } from "@/modules/jobs/runtime";
import { requireSessionUserId } from "@/modules/auth/session";
import { clearSmgPoison } from "@/modules/smg/poison";
import { markSmgInboxDirty } from "@/modules/smg/enqueue";
import { CDR_VACUUM_BUSY_MESSAGE } from "@/modules/storage/vacuum/gate";

/**
 * POST /api/smg/retry — clear the poison journal and drain the SMG inbox.
 */
export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireApiPermission("phones:request");
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
  const limited = pollRateLimiter.check(`smg-import:${userId}`);
  if (!limited.allowed) {
    return NextResponse.json(
      {
        accepted: false,
        error: "Too many import requests — try again shortly",
        code: "RATE_LIMITED",
        retryAfterSec: limited.retryAfterSec,
      },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  clearSmgPoison();
  markSmgInboxDirty();

  const result = await jobRuntime.enqueue({
    actionCode: "smg.import",
    trigger: "manual",
    actorUserId: userId,
  });

  if (!result.accepted) {
    const vacuum = result.reason?.includes("db.vacuum") === true;
    return NextResponse.json(
      {
        accepted: false,
        reason: result.reason ?? "rejected",
        error: vacuum ? CDR_VACUUM_BUSY_MESSAGE : undefined,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    accepted: true,
    message: "Импорт CDR SMG поставлен в очередь",
  });
}
