import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { zabbixTestRateLimiter } from "@/lib/rate-limit";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { requireSessionUserId } from "@/modules/auth/session";
import { probeZabbixAccess } from "@/modules/zabbix/dashboard";

export const maxDuration = 30;

/**
 * POST /api/settings/zabbix/test — login and resolve the saved graphs.
 * The body is empty. The password is the one already stored.
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

  const limited = zabbixTestRateLimiter.check(`zabbix-test:${userId}`);
  if (!limited.allowed) {
    return NextResponse.json(
      {
        error: "Too many Zabbix test requests — try again shortly",
        code: "RATE_LIMITED",
        retryAfterSec: limited.retryAfterSec,
      },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  const started = Date.now();
  const test = await probeZabbixAccess();
  const ip = await getRequestIp();
  await auditService.append({
    actorUserId: userId,
    action: AUDIT_ACTIONS.ZABBIX_TEST,
    entityType: "app_settings",
    entityId: "1",
    ip,
    meta: {
      result: test.result,
      durationMs: Date.now() - started,
      slots: test.slots,
    },
  });

  return NextResponse.json(
    {
      test: {
        result: test.result,
        detail: test.detail,
        durationMs: Date.now() - started,
      },
    },
    { status: test.result === "success" ? 200 : 502 },
  );
}
