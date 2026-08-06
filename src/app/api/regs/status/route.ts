import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { getRegistrationsOperationalStatus } from "@/modules/registrations/status";

/**
 * GET /api/regs/status — last poll + registration counts for ops widgets.
 * Protected with regs:read. Local DB only.
 */
export async function GET() {
  const gate = await requireApiPermission("regs:read");
  if (!gate.ok) return gate.response;

  const status = await getRegistrationsOperationalStatus();
  return NextResponse.json(status);
}
