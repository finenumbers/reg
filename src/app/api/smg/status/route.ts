import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { getSmgStatus } from "@/modules/smg/service";
import { cdrVacuumBusyResponse } from "@/modules/storage/vacuum/http";

/**
 * GET /api/smg/status — whether SMG calls changed since a job id.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;
  const busy = cdrVacuumBusyResponse();
  if (busy) return busy;

  const since = new URL(request.url).searchParams.get("since");
  const data = await getSmgStatus(since);
  return NextResponse.json(data);
}
