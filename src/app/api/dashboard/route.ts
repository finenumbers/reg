import { NextResponse } from "next/server";
import { requireApiSession } from "@/modules/auth/guards";
import { getDashboardSnapshot } from "@/modules/dashboard/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard — operator snapshot. Session cookie only.
 * Machine API keys are not accepted: this is the home screen, not a read API.
 */
export async function GET() {
  const gate = await requireApiSession();
  if (!gate.ok) return gate.response;

  const snapshot = await getDashboardSnapshot(gate.ctx.authz.permissions);
  return NextResponse.json(snapshot);
}
