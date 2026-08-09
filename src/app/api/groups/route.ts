import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { listRoutingGroups } from "@/modules/groups/service";

/**
 * GET /api/groups — routing groups catalog snapshot.
 */
export async function GET() {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  const data = await listRoutingGroups();
  return NextResponse.json(data);
}
