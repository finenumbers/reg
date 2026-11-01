import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { didTestRateLimiter } from "@/lib/rate-limit";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { runDidConnectionTest } from "@/modules/did/test-connection";
import { requireSessionUserId } from "@/modules/auth/session";

/**
 * POST /api/settings/did/test — probe the free-number list (settings:write).
 * The probe counts the catalog. It does not write anything in DID.
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

  const limited = didTestRateLimiter.check(`did-test:${userId}`);
  if (!limited.allowed) {
    return NextResponse.json(
      {
        error: "Too many DID test requests — try again shortly",
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
  const test = await runDidConnectionTest();

  await auditService.append({
    actorUserId: userId,
    action: AUDIT_ACTIONS.DID_TEST,
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
