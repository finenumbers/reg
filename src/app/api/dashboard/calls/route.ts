import { NextResponse } from "next/server";
import { requireApiSession } from "@/modules/auth/guards";
import {
  DASHBOARD_NODE_REJECTED,
  parseDashboardAntifraudNode,
} from "@/modules/dashboard/antifraud-nodes";
import { getDashboardCalls } from "@/modules/dashboard/calls";
import { parseDashboardSeries } from "@/modules/dashboard/series";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNAVAILABLE = "График звонков недоступен.";

/**
 * GET /api/dashboard/calls — today's chart and the rolling last two hours.
 * Query `series` selects the call set. Missing means phone traffic.
 * Query `node` limits the three antifraud charts to one syslog IP.
 * A blank node is every node. A non-antifraud series ignores it.
 * Session cookie only. Without phones:read the body is hidden and CDR is not read.
 * An unknown series or a node that is not in the antifraud menu does not read CDR.
 */
export async function GET(request: Request) {
  const gate = await requireApiSession();
  if (!gate.ok) return gate.response;

  const params = new URL(request.url).searchParams;
  const series = parseDashboardSeries(params.get("series"));
  if (!series) {
    return NextResponse.json(
      { status: "unavailable", message: UNAVAILABLE },
      { status: 400 },
    );
  }
  const node = parseDashboardAntifraudNode(series, params.get("node"));
  if (!node.ok) {
    return NextResponse.json({ message: DASHBOARD_NODE_REJECTED }, { status: 400 });
  }

  const calls = await getDashboardCalls(gate.ctx.authz.permissions, series, node.ip);
  if (calls.status === "rejected") {
    return NextResponse.json({ message: calls.message }, { status: 400 });
  }
  return NextResponse.json(calls);
}
