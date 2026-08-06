import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { pollRateLimiter } from "@/lib/rate-limit";
import { jobRuntime } from "@/modules/jobs/runtime";

/**
 * POST /api/regs/poll — enqueue a manual regs.poll job (backend only).
 * Protected with regs:poll. Anti-overlap enforced by job runtime.
 * Hardening: same-origin check + per-user rate limit.
 */
export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireApiPermission("regs:poll");
  if (!gate.ok) return gate.response;

  const userId = gate.ctx.session.user.id;
  const limited = pollRateLimiter.check(`poll:${userId}`);
  if (!limited.allowed) {
    return NextResponse.json(
      {
        accepted: false,
        error: "Too many poll requests — try again shortly",
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
    actionCode: "regs.poll",
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
    message: "regs.poll enqueued",
  });
}
