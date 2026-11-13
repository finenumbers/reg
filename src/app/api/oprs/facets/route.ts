import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { parseOprsFacetSearch } from "@/modules/oprs/query";
import { listOprsFacets } from "@/modules/oprs/service";
import { OprsQueryError } from "@/modules/oprs/where";
import { cdrVacuumBusyResponse } from "@/modules/storage/vacuum/http";

/**
 * GET /api/oprs/facets — distinct values inside the open OPRS snapshot.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;
  const busy = cdrVacuumBusyResponse();
  if (busy) return busy;

  const url = new URL(request.url);
  try {
    const data = await listOprsFacets(parseOprsFacetSearch(url.searchParams));
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
