import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { voipmonitorTestRateLimiter } from "@/lib/rate-limit";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { requireSessionUserId } from "@/modules/auth/session";
import { VoipmonitorClient } from "@/modules/voipmonitor/client";
import { loadVoipmonitorRuntime } from "@/modules/voipmonitor/credentials";

/**
 * POST /api/settings/voipmonitor/test — probe getVoipCalls (settings:write).
 * Does not write CDR links.
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

  const limited = voipmonitorTestRateLimiter.check(`voipmonitor-test:${userId}`);
  if (!limited.allowed) {
    return NextResponse.json(
      {
        error: "Too many VoIPmonitor test requests — try again shortly",
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
  const runtime = await loadVoipmonitorRuntime();
  let result = "error";
  let detail: string | null = null;
  if (!runtime.apiUrl || !runtime.user || !runtime.password) {
    detail = "Сначала сохраните API URL, пользователя и пароль";
  } else {
    try {
      const client = new VoipmonitorClient({
        apiUrl: runtime.apiUrl,
        user: runtime.user,
        password: runtime.password,
      });
      const to = new Date();
      const from = new Date(to.getTime() - 15 * 60 * 1000);
      const calls = await client.listVoipCallsRange(from, to);
      result = "success";
      detail = `Ответ API: ${calls.length} звонков за 15 минут`;
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }
  }

  const ip = await getRequestIp();
  await auditService.append({
    actorUserId: userId,
    action: AUDIT_ACTIONS.VOIPMONITOR_TEST,
    entityType: "app_settings",
    entityId: "1",
    ip,
    meta: { result, durationMs: Date.now() - started },
  });

  const httpStatus = result === "success" ? 200 : 502;
  return NextResponse.json(
    {
      test: {
        result,
        detail,
        durationMs: Date.now() - started,
      },
    },
    { status: httpStatus },
  );
}
