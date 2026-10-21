import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { sshTestRateLimiter } from "@/lib/rate-limit";
import { requireSessionUserId } from "@/modules/auth/session";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { parseStat } from "@/modules/antifraud/cursor";
import { loadParkingPrivateKeyPem } from "@/modules/antifraud/secret";
import { readCallsStat, withParkingConnection } from "@/modules/antifraud/ssh-read";

/**
 * POST /api/settings/parking/test — auth plus stat of calls.log.
 * Does not write anything on parking.finenumbers.com.
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

  const limited = sshTestRateLimiter.check(`parking-test:${userId}`);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Too many requests", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  const pem = await loadParkingPrivateKeyPem();
  if (!pem) {
    return NextResponse.json(
      { error: "Ключ Parking не загружен", code: "NO_PRIVATE_KEY" },
      { status: 400 },
    );
  }

  const ip = await getRequestIp();
  try {
    const read = await withParkingConnection(pem, (exec) => readCallsStat(exec));
    const stat = parseStat(read.stdout.toString("utf8"));
    if (!stat) {
      await auditService.append({
        actorUserId: userId,
        action: AUDIT_ACTIONS.PARKING_TEST,
        entityType: "parking_ssh_secret",
        entityId: "1",
        ip,
        meta: { result: "bad_stat" },
      });
      return NextResponse.json(
        { error: "Неожиданный ответ stat", detail: "Неожиданный ответ stat" },
        { status: 502 },
      );
    }
    const detail = `Файл читается, ${stat.size.toString()} байт`;
    await auditService.append({
      actorUserId: userId,
      action: AUDIT_ACTIONS.PARKING_TEST,
      entityType: "parking_ssh_secret",
      entityId: "1",
      ip,
      meta: { result: "success", bytes: stat.size.toString() },
    });
    return NextResponse.json({ detail });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Проверка не удалась";
    await auditService.append({
      actorUserId: userId,
      action: AUDIT_ACTIONS.PARKING_TEST,
      entityType: "parking_ssh_secret",
      entityId: "1",
      ip,
      meta: { result: "error" },
    });
    return NextResponse.json({ error: detail, detail }, { status: 502 });
  }
}
