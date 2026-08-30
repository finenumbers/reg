import { NextResponse } from "next/server";
import { parseFiltersParam } from "@/components/column-filters/types";
import { requireApiPermission } from "@/modules/auth/guards";
import { parseTrafficFlagParam } from "@/modules/traffic/row-flags";
import { listTrafficFacets } from "@/modules/traffic/service";

/**
 * GET /api/traffic/facets — distinct values + counts for one CDR column.
 */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const column = url.searchParams.get("column")?.trim() ?? "";
  if (!column) {
    return NextResponse.json(
      { error: "column is required", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const filters = parseFiltersParam(url.searchParams.get("filters"));
  const phoneQ = url.searchParams.get("phoneQ") ?? undefined;
  const month = url.searchParams.get("month") ?? undefined;
  const phantom = parseTrafficFlagParam(url.searchParams.get("phantom"));
  const callErrors = parseTrafficFlagParam(url.searchParams.get("callErrors"));
  const q = url.searchParams.get("q") ?? undefined;
  const limitRaw = Number(url.searchParams.get("limit") ?? "200");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 200;

  const data = await listTrafficFacets({
    column,
    filters,
    phoneQ,
    month,
    phantom,
    callErrors,
    q,
    limit,
  });

  return NextResponse.json(data);
}
