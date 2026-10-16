import { NextResponse } from "next/server";
import { requireApiSession } from "@/modules/auth/guards";
import { getDashboardCalls } from "@/modules/dashboard/calls";
import { parseDashboardSeries } from "@/modules/dashboard/series";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNAVAILABLE = "График звонков недоступен.";

/**
 * GET /api/dashboard/calls — today's chart and the rolling last two hours.
 * Query `series` selects the call set. Missing means phone traffic.
 * Session cookie only. Without phones:read the body is hidden and CDR is not read.
 * An unknown series does not read CDR.
 */
export async function GET(request: Request) {
  const gate = await requireApiSession();
  if (!gate.ok) return gate.response;

  const series = parseDashboardSeries(new URL(request.url).searchParams.get("series"));
  if (!series) {
    return NextResponse.json(
      { status: "unavailable", message: UNAVAILABLE },
      { status: 400 },
    );
  }

  const calls = await getDashboardCalls(gate.ctx.authz.permissions, series);
  return NextResponse.json(calls);
}
