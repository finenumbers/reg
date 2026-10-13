import { NextResponse } from "next/server";
import { parseFiltersParam } from "@/components/column-filters/types";
import { requireApiPermission } from "@/modules/auth/guards";
import { listSmgFacets } from "@/modules/smg/service";
import { cdrVacuumBusyResponse } from "@/modules/storage/vacuum/http";

/**
 * GET /api/smg/facets — distinct values for one SMG CDR column on one gateway.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;
  const busy = cdrVacuumBusyResponse();
  if (busy) return busy;

  const url = new URL(request.url);
  const column = url.searchParams.get("column")?.trim() ?? "";
  if (!column) {
    return NextResponse.json(
      { error: "column is required", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  const limitRaw = Number(url.searchParams.get("limit") ?? "200");
  const data = await listSmgFacets({
    column,
    filters: parseFiltersParam(url.searchParams.get("filters")),
    phoneQ: url.searchParams.get("phoneQ") ?? undefined,
    month: url.searchParams.get("month") ?? undefined,
    device: url.searchParams.get("device") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    limit: Number.isFinite(limitRaw) ? limitRaw : 200,
  });
  return NextResponse.json(data);
}
