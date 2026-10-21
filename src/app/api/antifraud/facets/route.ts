import { NextResponse } from "next/server";
import { parseFiltersParam } from "@/components/column-filters/types";
import { requireApiPermission } from "@/modules/auth/guards";
import { isRadiusFacetColumn } from "@/modules/antifraud/columns";
import { listRadiusFacets } from "@/modules/antifraud/service";

/** GET /api/antifraud/facets — distinct values for one low-cardinality column. */
export async function GET(request: Request) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const column = url.searchParams.get("column")?.trim() ?? "";
  if (!isRadiusFacetColumn(column)) {
    return NextResponse.json(
      { error: "column is required", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  const limitRaw = Number(url.searchParams.get("limit") ?? "200");
  const data = await listRadiusFacets({
    column,
    filters: parseFiltersParam(url.searchParams.get("filters")),
    phoneQ: url.searchParams.get("phoneQ") ?? undefined,
    month: url.searchParams.get("month") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    limit: Number.isFinite(limitRaw) ? limitRaw : 200,
  });
  return NextResponse.json(data);
}
