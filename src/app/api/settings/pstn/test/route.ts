import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { pstnTestRateLimiter } from "@/lib/rate-limit";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { runPstnConnectionTest } from "@/modules/pstn";
import { requireSessionUserId } from "@/modules/auth/session";

/**
 * POST /api/settings/pstn/test — probe PSTN lookup (settings:write).
 * Does not write pstn_phone_cache.
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

  const limited = pstnTestRateLimiter.check(`pstn-test:${userId}`);
  if (!limited.allowed) {
    return NextResponse.json(
      {
        error: "Too many PSTN test requests — try again shortly",
        code: "RATE_LIMITED",
        retryAfterSec: limited.retryAfterSec,
      },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  const ip = await getRequestIp();
  const test = await runPstnConnectionTest();

  await auditService.append({
    actorUserId: userId,
    action: AUDIT_ACTIONS.PSTN_TEST,
    entityType: "app_settings",
    entityId: "1",
    ip,
    meta: {
      result: test.result,
      durationMs: test.durationMs,
    },
  });

  const httpStatus = test.result === "success" ? 200 : 502;
  return NextResponse.json({ test }, { status: httpStatus });
}
