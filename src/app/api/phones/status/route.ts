import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { getPhonesOperationalStatus } from "@/modules/phones/service";

/**
 * GET /api/phones/status — last phones.sync job status (local DB).
 */
export async function GET() {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  const data = await getPhonesOperationalStatus();
  return NextResponse.json(data);
}
