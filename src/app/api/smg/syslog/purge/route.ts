import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { logger } from "@/lib/logger";
import { syslogPurgeRateLimiter } from "@/lib/rate-limit";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import { getRequestIp } from "@/lib/request-ip";
import { isDockerBridgeDevice } from "@/modules/smg-syslog/browse";
import { canonicalIpv4 } from "@/modules/smg-syslog/ip";
import { syslogNodeExists } from "@/modules/smg-syslog/nodes";
import { syslogRoot } from "@/modules/smg-syslog/paths";
import { purgeSyslogBefore } from "@/modules/smg-syslog/purge";

export const runtime = "nodejs";

/**
 * POST /api/smg/syslog/purge — delete this device's files strictly before a complete month.
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
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }

  const limited = syslogPurgeRateLimiter.check(`syslog-purge:${userId}`);
  if (!limited.allowed) {
    return NextResponse.json(
      {
        error: "Слишком много запусков удаления — подождите",
        code: "RATE_LIMITED",
        retryAfterSec: limited.retryAfterSec,
      },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  let json: unknown = null;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Некорректное тело запроса", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const device = typeof body.device === "string" ? body.device : "";
  const year = typeof body.year === "string" ? body.year : "";
  const month = typeof body.month === "string" ? body.month : "";
  const ip = canonicalIpv4(device);
  if (!ip || !/^\d{4}$/.test(year) || !/^\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "Некорректный запрос", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  if (!isDockerBridgeDevice(ip) && !(await syslogNodeExists(ip))) {
    return NextResponse.json(
      { error: "Узел не найден", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  const result = await purgeSyslogBefore(syslogRoot(), ip, { year, month }, new Date());
  const deleted = result.deleted.map((row) => `${row.year}-${row.month}`);
  if (result.ok || result.deleted.length > 0) {
    await auditService.append({
      actorUserId: userId,
      action: AUDIT_ACTIONS.SMG_SYSLOG_PURGE,
      entityType: "smg_syslog_node",
      entityId: ip,
      ip: await getRequestIp(),
      meta: {
        ip,
        cutoff: `${year}-${month}`,
        deletedMonths: deleted,
        complete: result.ok,
      },
    });
  }
  if (!result.ok && result.deleted.length === 0) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: 400 },
    );
  }
  if (!result.ok) {
    logger.warn("smg.syslog.purge_partial", { ip, cutoff: `${year}-${month}`, deleted });
    return NextResponse.json(
      { error: result.message, code: "PARTIAL", deleted },
      { status: 500 },
    );
  }
  logger.info("smg.syslog.purge", {
    ip,
    cutoff: `${year}-${month}`,
    deleted: deleted.length,
  });
  return NextResponse.json({ deleted });
}
