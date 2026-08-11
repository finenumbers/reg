import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { pollRateLimiter } from "@/lib/rate-limit";
import { jobRuntime } from "@/modules/jobs/runtime";
import { requireSessionUserId } from "@/modules/auth/session";

/**
 * POST /api/phones/request — enqueue phones.sync (backend only).
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
  const limited = pollRateLimiter.check(`phones-sync:${userId}`);
  if (!limited.allowed) {
    return NextResponse.json(
      {
        accepted: false,
        error: "Too many sync requests — try again shortly",
        code: "RATE_LIMITED",
        retryAfterSec: limited.retryAfterSec,
      },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  const result = await jobRuntime.enqueue({
    actionCode: "phones.sync",
    trigger: "manual",
    actorUserId: userId,
  });

  if (!result.accepted) {
    return NextResponse.json(
      {
        accepted: false,
        reason: result.reason ?? "rejected",
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    accepted: true,
    message: "phones.sync enqueued",
  });
}
