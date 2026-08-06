import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { sshTestRateLimiter } from "@/lib/rate-limit";
import { isSshTestError } from "@/modules/ssh/errors";
import { runSshConnectionTest } from "@/modules/ssh/test-connection";

/**
 * POST /api/settings/ssh/test — SSH auth/session connection test (ssh:test).
 *
 * Does NOT execute check_regs.sh / regs.poll.
 * Does NOT update registration data.
 * Hardening: same-origin + per-user rate limit.
 */
export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireApiPermission("ssh:test");
  if (!gate.ok) return gate.response;

  const limited = sshTestRateLimiter.check(`ssh-test:${gate.ctx.session.user.id}`);
  if (!limited.allowed) {
    return NextResponse.json(
      {
        error: "Too many SSH test requests — try again shortly",
        code: "RATE_LIMITED",
        retryAfterSec: limited.retryAfterSec,
      },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  try {
    const ip = await getRequestIp();
    const test = await runSshConnectionTest({
      userId: gate.ctx.session.user.id,
      ip,
    });

    const httpStatus = test.result === "success" ? 200 : 502;
    return NextResponse.json(
      {
        test: {
          id: test.id,
          result: test.result,
          detail: test.detail,
          durationMs: test.durationMs,
          profileId: test.profileId,
          createdAt: test.createdAt.toISOString(),
          mode: "auth_session_only",
        },
      },
      { status: httpStatus },
    );
  } catch (error) {
    if (isSshTestError(error)) {
      const status =
        error.code === "PROFILE_INCOMPLETE" || error.code === "NO_PRIVATE_KEY"
          ? 400
          : error.code === "DECRYPT_FAILED"
            ? 500
            : 502;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status },
      );
    }
    throw error;
  }
}
