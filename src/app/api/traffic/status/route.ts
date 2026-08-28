import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { getTrafficStatus } from "@/modules/traffic/service";

/**
 * GET /api/traffic/status — last cdr.import job status.
 */
export async function GET() {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  const data = await getTrafficStatus();
  return NextResponse.json(data);
}
