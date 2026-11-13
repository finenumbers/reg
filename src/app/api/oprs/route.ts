import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { OprsQueryError } from "@/modules/oprs/where";
import { parseOprsListSearch } from "@/modules/oprs/query";
import { listOprs } from "@/modules/oprs/service";
import { cdrVacuumBusyResponse } from "@/modules/storage/vacuum/http";

/**
 * GET /api/oprs — outgoing mobile-RF calls, one importedAt snapshot.
 * The predicate is fixed here. /api/traffic does not accept it.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;
  const busy = cdrVacuumBusyResponse();
  if (busy) return busy;

  const url = new URL(request.url);
  try {
    const data = await listOprs(parseOprsListSearch(url.searchParams));
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof OprsQueryError) {
      return NextResponse.json(
        { error: error.message, code: "BAD_REQUEST" },
        { status: 400 },
      );
    }
    throw error;
  }
}
