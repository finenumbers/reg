import { NextResponse } from "next/server";
import { requireApiSession } from "@/modules/auth/guards";
import { getZabbixDashboard } from "@/modules/zabbix/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/dashboard/zabbix — two configured graphs, last 120 minutes.
 * Session cookie only. Without phones:read the body is hidden.
 * The reply has no Zabbix address, password, or token.
 */
export async function GET() {
  const gate = await requireApiSession();
  if (!gate.ok) return gate.response;
  const body = await getZabbixDashboard(gate.ctx.authz.permissions);
  return NextResponse.json(body);
}
