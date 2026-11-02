import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { rtuSoapTestRateLimiter } from "@/lib/rate-limit";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { requireSessionUserId } from "@/modules/auth/session";
import { loadRtuSoapAccount } from "@/modules/rtu-soap/credentials";
import { acquireRtuSoapTest, releaseRtuSoapTest } from "@/modules/rtu-soap/flight";
import { probeRtuSoapAccess } from "@/modules/rtu-soap/probe";

export const maxDuration = 30;

/**
 * POST /api/settings/rtu/test — one read of getObjects.
 * Does not insert, update, delete, or call a procedure.
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

  if (!acquireRtuSoapTest()) {
    return NextResponse.json(
      {
        error: "Проверка доступа уже выполняется",
        code: "RATE_LIMITED",
        retryAfterSec: 1,
      },
      { status: 429, headers: { "Retry-After": "1" } },
    );
  }

  try {
    const limited = rtuSoapTestRateLimiter.check(`rtu-soap-test:${userId}`);
    if (!limited.allowed) {
      return NextResponse.json(
        {
          error: "Слишком много проверок доступа — повторите позже",
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
    const account = await loadRtuSoapAccount();
    const ip = await getRequestIp();
    if (!account.ok) {
      const status = account.code === "DECRYPT_FAILED" ? 500 : 400;
      const detail =
        account.code === "DECRYPT_FAILED"
          ? "Не удалось прочитать сохранённый пароль"
          : "Сначала сохраните URL, логин и пароль";
      await auditService.append({
        actorUserId: userId,
        action: AUDIT_ACTIONS.RTU_SOAP_TEST,
        entityType: "app_settings",
        entityId: "1",
        ip,
        meta: { result: account.code, tableCount: 0, procedureCount: 0 },
      });
      return NextResponse.json(
        { error: detail, code: account.code },
        { status },
      );
    }

    const report = await probeRtuSoapAccess({
      origin: account.origin,
      login: account.login,
      password: account.password,
      caPem: account.caPem,
    });
    await auditService.append({
      actorUserId: userId,
      action: AUDIT_ACTIONS.RTU_SOAP_TEST,
      entityType: "app_settings",
      entityId: "1",
      ip,
      meta: {
        result: report.code,
        origin: account.origin,
        login: account.login,
        tableCount: report.tableCount,
        procedureCount: report.procedureCount,
      },
    });

    const httpStatus = report.code === "ok" ? 200 : 502;
    return NextResponse.json(
      {
        test: {
          result: report.code === "ok" ? "success" : report.code,
          detail: report.detail,
          durationMs: Date.now() - started,
          tableCount: report.tableCount,
          procedureCount: report.procedureCount,
          procedures: report.procedures,
          proceduresOmitted: report.proceduresOmitted,
          peerFingerprint: report.peerFingerprint,
          peerSubject: report.peerSubject,
        },
      },
      { status: httpStatus },
    );
  } finally {
    releaseRtuSoapTest();
  }
}
