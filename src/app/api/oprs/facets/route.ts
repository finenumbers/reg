import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import {
  acquireOprsFacetLane,
  OprsFacetLaneAbort,
  releaseOprsFacetLane,
} from "@/modules/oprs/facet-lane";
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
  let input;
  try {
    input = parseOprsFacetSearch(url.searchParams);
  } catch (error) {
    if (error instanceof OprsQueryError) {
      return NextResponse.json(
        { error: error.message, code: "BAD_REQUEST" },
        { status: 400 },
      );
    }
    throw error;
  }

  let held = false;
  try {
    await acquireOprsFacetLane(request.signal);
    held = true;
    if (request.signal.aborted) {
      return NextResponse.json({ error: "Отменено" }, { status: 499 });
    }
    const data = await listOprsFacets(input);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof OprsFacetLaneAbort) {
      return NextResponse.json({ error: "Отменено" }, { status: 499 });
    }
    if (error instanceof OprsQueryError) {
      return NextResponse.json(
        { error: error.message, code: "BAD_REQUEST" },
        { status: 400 },
      );
    }
    throw error;
  } finally {
    if (held) releaseOprsFacetLane();
  }
}
