import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { listStatsSnapshot } from "@/modules/stats/service";

/**
 * GET /api/stats — monthly PSTN/Trunk/LDC/platform CDR summary (phones:read).
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? undefined;
  const data = await listStatsSnapshot(month);
  return NextResponse.json(data);
}
