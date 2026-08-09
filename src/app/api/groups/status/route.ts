import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { getGroupsOperationalStatus } from "@/modules/groups/service";

/**
 * GET /api/groups/status — last groups.sync status.
 */
export async function GET() {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  const data = await getGroupsOperationalStatus();
  return NextResponse.json(data);
}
