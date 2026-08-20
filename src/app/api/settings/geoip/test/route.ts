import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { geoipTestRateLimiter } from "@/lib/rate-limit";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { runGeoipConnectionTest } from "@/modules/geoip";
import { requireSessionUserId } from "@/modules/auth/session";

/**
 * POST /api/settings/geoip/test — probe GeoIP lookup (settings:write).
 * Does not write ip_geo_cache.
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

  const limited = geoipTestRateLimiter.check(`geoip-test:${userId}`);
  if (!limited.allowed) {
    return NextResponse.json(
      {
        error: "Too many GeoIP test requests — try again shortly",
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
  const test = await runGeoipConnectionTest();

  await auditService.append({
    actorUserId: userId,
    action: AUDIT_ACTIONS.GEOIP_TEST,
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
