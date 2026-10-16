import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { lookupSmgTrace } from "@/modules/smg-trace/lookup";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/smg/calls/[id]/trace — syslog card for one CDR row. */
export async function GET(_request: Request, context: RouteContext) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Call is required", code: "BAD_REQUEST" }, { status: 400 });
  }

  const trace = await lookupSmgTrace(id);
  if (!trace) {
    return NextResponse.json({ error: "Call not found", code: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json(trace);
}
