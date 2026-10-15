import { NextResponse } from "next/server";
import { requireApiSession } from "@/modules/auth/guards";
import { getDashboardCalls } from "@/modules/dashboard/calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/calls — concurrent softswitch calls for today and the last hour.
 * Session cookie only. Without phones:read the body is hidden and CDR is not read.
 */
export async function GET() {
  const gate = await requireApiSession();
  if (!gate.ok) return gate.response;

  const calls = await getDashboardCalls(gate.ctx.authz.permissions);
  return NextResponse.json(calls);
}
