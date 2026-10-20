import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit/service";
import { deleteDialException } from "@/modules/exceptions/service";
import { requireTariffSession } from "@/modules/tariffs/guard";

type RouteContext = { params: Promise<{ abc: string }> };

/**
 * DELETE /api/exceptions/:abc — remove one digit ABC and queue a CDR rerate.
 */
export async function DELETE(request: Request, context: RouteContext) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const gate = await requireTariffSession();
  if (!gate.ok) return gate.response;

  const { abc } = await context.params;
  const result = await deleteDialException(
    decodeURIComponent(abc),
    gate.ctx.session.user.id,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  await auditService.append({
    actorUserId: gate.ctx.session.user.id,
    action: AUDIT_ACTIONS.EXCEPTIONS_DELETE,
    entityType: "dial_exception",
    entityId: abc,
    meta: { abc },
    ip: await getRequestIp(),
  });

  return NextResponse.json({ ok: true });
}
