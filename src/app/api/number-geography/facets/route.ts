import { NextResponse } from "next/server";
import { parseFiltersParam } from "@/components/column-filters/types";
import { requireApiPermission } from "@/modules/auth/guards";
import { listNumberGeographyFacets } from "@/modules/number-geography/service";

/**
 * GET /api/number-geography/facets — one column, other filters applied.
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
  const blockedOnly =
    url.searchParams.get("blockedOnly") === "1" ||
    url.searchParams.get("blockedOnly") === "true";
  const q = url.searchParams.get("q") ?? undefined;
  const limitRaw = Number(url.searchParams.get("limit") ?? "200");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 200;

  const data = await listNumberGeographyFacets({
    column,
    filters,
    phoneQ,
    blockedOnly,
    q,
    limit,
  });

  return NextResponse.json(data);
}
