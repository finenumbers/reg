import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { requireSessionUserId } from "@/modules/auth/session";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { testSmgFtpListener } from "@/modules/smg/ftp-server";

/**
 * POST /api/settings/smg-ftp/test — check whether the SMG FTP listener is up.
 */
export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireApiPermission("settings:write");
  if (!gate.ok) return gate.response;

  let userId: string | undefined;
  try {
    userId = requireSessionUserId(gate.ctx);
  } catch {
    userId = undefined;
  }

  const started = Date.now();
  const test = await testSmgFtpListener();
  const ip = await getRequestIp();
  await auditService.append({
    actorUserId: userId,
    action: AUDIT_ACTIONS.SMG_FTP_TEST,
    entityType: "app_settings",
    entityId: "1",
    ip,
    meta: { result: test.result },
  });

  return NextResponse.json({
    test: {
      result: test.result,
      detail: test.detail,
      durationMs: Date.now() - started,
    },
  });
}
