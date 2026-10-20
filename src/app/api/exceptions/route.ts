import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit/service";
import { addDialException, listDialExceptions } from "@/modules/exceptions/service";
import { requireTariffSession } from "@/modules/tariffs/guard";

/**
 * GET /api/exceptions — digit ABC exceptions. Session + phones:read.
 * API keys are rejected.
 */
export async function GET() {
  const gate = await requireTariffSession();
  if (!gate.ok) return gate.response;
  const items = await listDialExceptions();
  return NextResponse.json({ items });
}

/**
 * POST /api/exceptions — add one digit ABC and queue a CDR rerate.
 */
export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireTariffSession();
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "ABC — только цифры, от 1 до 15 знаков" },
      { status: 400 },
    );
  }
  const abc =
    body && typeof body === "object" && "abc" in body
      ? (body as { abc?: unknown }).abc
      : undefined;
  const result = await addDialException(abc, gate.ctx.session.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  await auditService.append({
    actorUserId: gate.ctx.session.user.id,
    action: AUDIT_ACTIONS.EXCEPTIONS_ADD,
    entityType: "dial_exception",
    entityId: typeof abc === "string" ? abc.trim() : "",
    meta: { abc: typeof abc === "string" ? abc.trim() : "" },
    ip: await getRequestIp(),
  });

  return NextResponse.json({ ok: true });
}
